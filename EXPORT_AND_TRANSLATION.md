# Arik: Export, Print, and Translation

## The core idea

Every piece of drafted content Arik produces (an appeal, a dispute letter,
a phone script, a PAP application) already exists as structured content in
the database - the facts, the citation, the ask. What this feature adds is
a **rendering layer** on top of that same content: the same underlying
draft gets presented differently depending on who it's for and how the
patient needs to use it. This is cheap because it's reformatting/
retranslating existing content, not generating new content from scratch
each time.

## Audience-adapted formats

Same content, different presentation, generated from one source:

- **Phone script** - first-person, conversational, meant to be read aloud
  or glanced at during a call. "Say this to the person on the phone."
  This is the direct answer to "I don't feel comfortable calling and
  saying this myself" - Arik hands them the words.
- **Formal letter** - for mailing or handing to hospital billing, a payer,
  or a manufacturer's PAP department. Proper letter formatting, patient
  info block, citation of the specific policy/rule being invoked.
- **Printable one-pager / handout** - for handing directly to someone in
  person (a pharmacist, a billing office window, a front desk) - clean,
  minimal, the ask and the supporting fact front and center, not buried
  in paragraph text.
- **Form-ready document** - the actual application/appeal form, pre-filled
  per BEHAVIOR.md's autonomy tiers, ready for the one remaining signature.

All four are renderings of the same underlying `content` + `citation` +
`ask` - the generation step happens once, the format step is cheap and
can run per-request without re-deriving the substance each time.

## Export mechanics - all close to free

- **Print**: browser-native print CSS (`window.print()` with a dedicated
  print stylesheet). Zero cost, no server-side PDF generation service
  needed. This is the cheapest possible path to "give me something I can
  print."
- **Save as image**: client-side DOM-to-image libraries (html2canvas or
  similar) snapshot the rendered document into a PNG the patient can save
  to their phone - useful for handing something over in person without
  printing, or texting a script to themselves. Also free/cheap, runs
  entirely in the browser.
- **Neither of these needs a backend PDF-generation service** - keeping
  this client-side is what keeps it cheap and keeps the "light and
  cloneable" requirement intact.

## Translation

Reuse the same model that already drafted the content - translation is
just one more inference call on text that already exists, not a separate
service or pipeline. "Render this appeal in Spanish" is functionally the
same cost as any other model call in the system, so this doesn't add
meaningful expense.

Two distinct use cases worth keeping separate in the UI:
1. **Translate for the patient** - if English isn't the patient's first
   language, translate what Arik is telling *them* into their language
2. **Translate for the recipient** - if the entity being contacted (a
   provider's office, a billing department) primarily operates in a
   different language than the patient does, translate the *output
   document* into that language regardless of what language the patient
   used with Arik. These can be different languages in the same
   interaction - worth designing for that explicitly, not assuming
   they're always the same.

## What this means for the build

Add a generic rendering/output table rather than bolting export logic
onto each module separately:

```sql
create table output_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  source_type text not null,       -- 'denial_appeal', 'bill_dispute', 'pap_application', 'phone_script'
  source_id uuid,                  -- points back to denial_appeals.id, bill_audit_findings.id, etc.
  audience_format text not null,   -- 'phone_script', 'formal_letter', 'printable_handout', 'form_ready'
  language text default 'en',
  rendered_content text not null,
  created_at timestamptz default now()
);
```

One row per rendering, generated on demand when the patient picks a format
and language, not pre-generated for every possible combination up front -
keeps storage and generation cost proportional to what's actually used.
