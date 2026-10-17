# Reads saved TrumpRx product pages (trumprx.gov/p/<drug>, fetched with curl)
# and prints the per-strength prices from the page data, in dollars.
# Research aid for docs/research/brand_programs_25.csv; not run by the app.
# Usage: python -I scripts/research/trumprx_extract.py <dir of p_<slug>.html> <out.json>
import re, json, sys, glob, os

BS = chr(92)
STR = '"((?:[^"' + BS + BS + ']|' + BS + BS + '.)*)"'


def payload(path):
    s = open(path, encoding='utf-8').read()
    out = []
    for c in re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', s, flags=re.S):
        try:
            out.append(json.loads('"' + c + '"'))
        except Exception:
            pass
    return ''.join(out)


def balanced(s, i, o, cl):
    d = 0
    for j in range(i, len(s)):
        if s[j] == o:
            d += 1
        elif s[j] == cl:
            d -= 1
            if d == 0:
                return s[i:j + 1]


def field(seg, k):
    m = re.search('"' + k + '":' + STR, seg)
    return json.loads('"' + m.group(1) + '"') if m else None


def ref_text(big, val):
    # "$21" points at a text chunk "21:T<hex>,<text>"
    if not val or not val.startswith('$'):
        return val
    m = re.search(r'(?:^|\n)' + re.escape(val[1:]) + r':T([0-9a-f]+),', big)
    if not m:
        return None
    return big[m.end():m.end() + int(m.group(1), 16)]


rows = []
for p in sorted(glob.glob(sys.argv[1] + '/p_*.html')):
    big = payload(p)
    i = big.find('"pricingConfig"')
    if i < 0:
        continue
    cfg = big[i:i + 80000]
    slug = os.path.basename(p)[2:-5]
    j = cfg.find('"drugVariants"')
    variants = json.loads(balanced(cfg, cfg.find('[', j), '[', ']'))
    coupon = re.search(r'"coupon":\{"bin":"(\w*)","pcn":"(\w*)","group":"(\w*)","member":"(\w*)"\}', cfg)
    offer = ref_text(big, field(cfg, 'drugDisclaimer'))
    for v in variants:
        pr = v.get('price') or {}
        t = v.get('tiered') or {}
        cents = lambda x: None if x is None else x / 100
        rows.append(dict(
            slug=slug, drug=field(cfg, 'drugName'), generic=field(cfg, 'genericName'), company=field(cfg, 'companyDisplayName'),
            hero=field(cfg, 'type'), form=v.get('form'), strength=v.get('strength'), quantity=v.get('quantity'),
            trx_usd=cents(pr.get('trxPrice')), before_usd=cents(pr.get('beforePrice')),
            first_fills=t.get('discountedDoseCount'), first_fill_usd=cents(t.get('discountedDosePrice')), later_fill_usd=cents(t.get('regularDosePrice')),
            bin=coupon.group(1) if coupon else None, pcn=coupon.group(2) if coupon else None, group=coupon.group(3) if coupon else None,
            offer=offer, before_label=field(cfg, 'originalPriceDisclaimer')))
json.dump(rows, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(rows))
for r in rows:
    print(r['slug'], '|', r['form'], r['strength'], r['quantity'], '|', r['trx_usd'], r['before_usd'], r['first_fills'], r['later_fill_usd'], '|', r['hero'], (r['company'] or '').encode('ascii', 'replace').decode(), '|', (r['offer'] or '')[:60].encode('ascii', 'replace').decode())
