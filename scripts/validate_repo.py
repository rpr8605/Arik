#!/usr/bin/env python3
"""
Arik pre-build validation script.

Run this before writing any application code:
    python3 scripts/validate_repo.py

Catches the same class of bugs found during the manual consistency pass:
forward-reference errors in schema.sql, tables referenced in code that
don't exist in the schema, malformed JSON, and docs referencing tables
that were never actually added. This does NOT catch semantic/design
issues (contradictory requirements, missing business logic) - see
PRE_BUILD_CHECKLIST.md for the manual review that covers those.

Exit code 0 = all automated checks passed. Non-zero = stop and fix before
building anything.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FAILURES = []
WARNINGS = []


def fail(msg):
    FAILURES.append(msg)
    print(f"FAIL: {msg}")


def warn(msg):
    WARNINGS.append(msg)
    print(f"WARN: {msg}")


def ok(msg):
    print(f"OK:   {msg}")


def check_json_files():
    print("\n--- Checking JSON files parse ---")
    for path in REPO_ROOT.glob("*.json"):
        try:
            json.loads(path.read_text())
            ok(f"{path.name} is valid JSON")
        except json.JSONDecodeError as e:
            fail(f"{path.name} failed to parse: {e}")


def strip_sql_comments(text):
    """Remove -- comments before parsing, so comment text (like
    '-- references uploaded_documents(id), added as FK below') never gets
    mistaken for a real inline foreign key reference."""
    return re.sub(r"--.*$", "", text, flags=re.MULTILINE)


def extract_schema_tables_in_order(schema_text):
    """Return list of (table_name, char_offset) in the order they're created."""
    tables = []
    for match in re.finditer(r"create table (\w+)", schema_text):
        tables.append((match.group(1), match.start()))
    return tables


def extract_fk_references(schema_text):
    """Return list of (referencing_table, referenced_table, char_offset_of_reference)."""
    refs = []
    current_table = None
    current_table_start = 0
    table_starts = extract_schema_tables_in_order(schema_text)

    for i, (tname, tstart) in enumerate(table_starts):
        tend = table_starts[i + 1][1] if i + 1 < len(table_starts) else len(schema_text)
        block = schema_text[tstart:tend]
        for ref_match in re.finditer(r"references (\w+)\(", block):
            ref_table = ref_match.group(1)
            if ref_table == "users":
                continue  # auth.users is a Supabase built-in, not defined in this schema
            refs.append((tname, ref_table, tstart))
    return refs


def extract_deferred_fk_targets(schema_text):
    """Find columns that are deliberately left as plain uuid (no inline
    'references') specifically because a later ALTER TABLE attaches the FK.
    Returns set of (table, column) pairs covered by an ALTER TABLE ...
    ADD CONSTRAINT ... FOREIGN KEY (column) REFERENCES ... """
    covered = set()
    for alter_match in re.finditer(
        r"alter table (\w+)\s+add constraint \w+ foreign key \((\w+)\)",
        schema_text,
    ):
        covered.add((alter_match.group(1), alter_match.group(2)))
    return covered


def check_schema_sql():
    print("\n--- Checking schema.sql structure ---")
    schema_path = REPO_ROOT / "schema.sql"
    if not schema_path.exists():
        fail("schema.sql not found")
        return

    raw_text = schema_path.read_text()
    text = strip_sql_comments(raw_text)

    opens, closes = text.count("("), text.count(")")
    if opens != closes:
        fail(f"schema.sql has unbalanced parentheses: {opens} open vs {closes} close")
    else:
        ok(f"parentheses balanced ({opens} pairs)")

    tables_in_order = extract_schema_tables_in_order(text)
    table_names = [t[0] for t in tables_in_order]
    ok(f"found {len(table_names)} create table statements")

    dupes = [t for t in set(table_names) if table_names.count(t) > 1]
    if dupes:
        fail(f"duplicate table definitions: {dupes}")
    else:
        ok("no duplicate table names")

    table_position = {name: pos for name, pos in tables_in_order}
    deferred_fk_targets = extract_deferred_fk_targets(text)

    refs = extract_fk_references(text)
    real_forward_ref_problems = []
    for referencing, referenced, ref_pos in refs:
        if referenced not in table_position:
            fail(f"table '{referencing}' references undefined table '{referenced}'")
            continue
        if table_position[referenced] > table_position[referencing]:
            # Only a real problem if no later ALTER TABLE resolves it - an
            # inline `references` clause pointing forward is always broken
            # (Postgres won't allow it at CREATE TABLE time regardless of
            # what comes later), so any match here from extract_fk_references
            # (which only scans inline `references` inside CREATE TABLE
            # blocks) is a genuine bug, not a deferred-and-fixed case.
            real_forward_ref_problems.append((referencing, referenced))

    if real_forward_ref_problems:
        for referencing, referenced in real_forward_ref_problems:
            fail(
                f"genuine forward-reference bug: '{referencing}' has an "
                f"inline 'references {referenced}(...)' clause, but "
                f"'{referenced}' is defined later in the file. Postgres will "
                f"reject this at CREATE TABLE time. Fix by either reordering "
                f"the tables or converting this to a plain uuid column plus "
                f"a later ALTER TABLE ... ADD CONSTRAINT (see how "
                f"authorizations_on_file.document_id and "
                f"case_outcomes.proof_document_id already handle this)."
            )
    else:
        ok("no forward-reference problems in inline foreign keys")

    if deferred_fk_targets:
        ok(f"found {len(deferred_fk_targets)} intentionally-deferred FK(s) "
           f"resolved via ALTER TABLE: {sorted(deferred_fk_targets)}")

    alter_statements = text.count("alter table")
    ok(f"found {alter_statements} ALTER TABLE statement(s) total")

    return table_names


def check_route_ts_against_schema(schema_table_names):
    print("\n--- Checking route.ts table references against schema.sql ---")
    route_path = REPO_ROOT / "app" / "api" / "chat" / "route.ts"
    if not route_path.exists():
        warn("app/api/chat/route.ts not found, skipping cross-check")
        return

    text = route_path.read_text()
    referenced_tables = set(re.findall(r"\.from\(['\"](\w+)['\"]\)", text))

    if not schema_table_names:
        warn("no schema tables to check against")
        return

    schema_set = set(schema_table_names)
    for table in referenced_tables:
        if table not in schema_set:
            fail(
                f"route.ts queries table '{table}' which does not exist in "
                f"schema.sql - this will fail at runtime"
            )
        else:
            ok(f"route.ts table reference '{table}' exists in schema.sql")


def check_docs_reference_real_tables(schema_table_names):
    print("\n--- Checking .md docs for table names not in schema.sql ---")
    if not schema_table_names:
        warn("no schema tables to check against")
        return

    schema_set = set(schema_table_names)
    # Look for `create table X` blocks quoted inside markdown docs (docs that
    # include SQL snippets as illustration) and flag any not reflected in
    # the real schema.sql - this is exactly how tables got lost before.
    for md_path in REPO_ROOT.glob("*.md"):
        text = md_path.read_text()
        doc_tables = set(re.findall(r"create table (\w+)", text))
        missing = doc_tables - schema_set
        if missing:
            fail(
                f"{md_path.name} shows CREATE TABLE for {sorted(missing)} "
                f"but these are not in the real schema.sql - either add them "
                f"to schema.sql or update the doc"
            )


def check_md_file_references():
    print("\n--- Checking .md docs for referenced .md files that don't exist ---")
    existing = {p.name for p in REPO_ROOT.glob("*.md")}
    problems = 0
    for md_path in REPO_ROOT.glob("*.md"):
        text = md_path.read_text()
        # Any Something_Like_This.md (or chat_system_prompt.md) mention must
        # point at a file that actually exists at the repo root - dangling
        # doc references are how spec drift hides.
        refs = set(re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)\.md\b", text))
        for ref in sorted(refs):
            fname = f"{ref}.md"
            if fname not in existing:
                fail(
                    f"{md_path.name} references {fname} but that file does "
                    f"not exist in the repo"
                )
                problems += 1
    if problems == 0:
        ok(f"all .md file references resolve ({len(existing)} files present)")


def check_handoff_lists_all_files():
    print("\n--- Checking HANDOFF.md references every file in the repo ---")
    handoff_path = REPO_ROOT / "HANDOFF.md"
    if not handoff_path.exists():
        fail("HANDOFF.md not found")
        return

    handoff_text = handoff_path.read_text()
    md_files = [p.name for p in REPO_ROOT.glob("*.md") if p.name != "HANDOFF.md"]
    for fname in md_files:
        if fname not in handoff_text:
            warn(f"{fname} is not mentioned anywhere in HANDOFF.md - confirm it's intentionally out of scope or add a reference")


def main():
    print("=" * 60)
    print("Arik pre-build validation")
    print("=" * 60)

    check_json_files()
    table_names = check_schema_sql()
    check_route_ts_against_schema(table_names)
    check_docs_reference_real_tables(table_names)
    check_md_file_references()
    check_handoff_lists_all_files()

    print("\n" + "=" * 60)
    print(f"RESULT: {len(FAILURES)} failure(s), {len(WARNINGS)} warning(s)")
    print("=" * 60)

    if FAILURES:
        print("\nDo not proceed to writing application code until failures are resolved.")
        sys.exit(1)
    else:
        print("\nAutomated checks passed. Still complete PRE_BUILD_CHECKLIST.md before building.")
        sys.exit(0)


if __name__ == "__main__":
    main()
