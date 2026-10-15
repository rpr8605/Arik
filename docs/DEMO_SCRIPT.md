# Arik demo script

**Link:** https://arik-liard.vercel.app (open it on your phone, or on a laptop where it shows inside a phone frame)

Everything in the demo is sample data. People, hospitals, insurers and documents are made up. Drug prices are real and come from Arik's sourced data. Nothing is sent and nothing you type is kept past the session.

## 2-minute tour

| # | Tap | Say |
|---|---|---|
| 1 | Open the link. The logo fades in, then the welcome screen. | "This is Arik, an AI patient advocate. It works for the patient, not the insurer, pharmacy or drug maker." |
| 2 | **Check a medical bill** → **Pick the bill** → Luis's hospital bill | "Luis went to the ER. He snaps a photo of his bill." |
| 3 | Watch the reading animation, then tap **Looks right** | "Arik reads every line and checks what it read with him before it judges anything." |
| 4 | Scroll the findings. Tap box **3** on the bill. | "Four problems: a duplicate test, two lab panels that should be one, an extra room day, and a doctor charge worth asking about. That's $4,788 to question, and the total is exactly the sum of what's shown." |
| 5 | **Dispute with the hospital billing office** → **Looks good, send it** → draw a signature → **Send** | "Arik writes the letter, asks the hospital to hold the account from collections, and sends it once he signs. The receipt is marked 'Demo, not sent' because this is a demo." |
| 6 | Home (logo) → **Fight a denial** → **Pick the letter** → Tasha's denial letter | "Tasha's MRI was denied. Arik finds the reason, the date and her deadline right on the letter." |
| 7 | **Do both** | "One appeal to the insurer, one request to her doctor for the paperwork the plan said was missing. Many people never appeal." |
| 8 | Home → **Lower my prescription cost** → **Eliquis** | "This part is live. These are real programs and real prices from Arik's data, each with its source and the date it was checked." |
| 9 | Scroll to the call card | "Arik tells her who to call, what to say in English or Spanish, and what they'll ask for." |
| 10 | Home → **Try a sample patient** → **James** → the red **Needs you** row | "James cares for his mom on Medicare. Arik won't offer the manufacturer copay card, because using it with Medicare is against federal law. It says why, in plain words." |

## 30-second version

1. **Check a medical bill** → pick Luis's hospital bill → **Looks right**. Say: "Arik reads the bill and finds $4,788 in charges worth questioning."
2. **Dispute with the hospital billing office** → **Looks good, send it** → sign → **Send**. Say: "It writes the dispute letter and sends it for him."
3. Back home → **Lower my prescription cost** → **Eliquis**. Say: "And for prescriptions, these are real prices from real programs, with sources."

## What's real and what's scripted: likely questions

**1. Is Arik actually reading that bill?**
Not in this demo. The bill, the denial letter, the findings and the letters are scripted so the walkthrough is fast and never fails in a meeting. The real document reader (PDFs, photos, phone pictures) is already built for real uploads. The bill rules (duplicates, bundled lab panels, room-day counts) are the next build, and they plug into these same screens.

**2. Are the prices real?**
Yes. In the prescription flow, every option, price, source and "checked" date comes from Arik's database at the moment you tap. Nothing is invented. If a price isn't loaded, Arik says so instead of guessing. The one list price shown is a published point-in-time figure and is labeled that way.

**3. Does Arik really send letters and make calls?**
Not yet. Sending and calling are designed and on screen, and every receipt says "Demo, not sent" or "Coming soon, not sent." Real sending needs a fax and mail partner, and real calling needs a phone partner. Both need healthcare privacy agreements before they go live.

**4. How do you stop the AI from making things up?**
In the real chat ("Chat with Arik as Maria"), the AI only writes the explanation. Code checks every number and program name against Arik's sourced data. If anything doesn't match, the AI gets one chance to fix it, and after that code replaces the answer with a plain list of the sourced options. When there's no data, code answers "no data" without the AI. The Medicare copay-card rule and the source receipt are built in code, never left to the AI.

**5. What happens to someone's health information?**
The demo uses only made-up people, and sample patients are deleted after 60 minutes idle or when you tap Reset. For real users, identity details are encrypted, every consent change is logged, and a person can delete everything. Exactly which privacy laws apply to Arik is being reviewed with counsel; the product is built to the strictest standard in the meantime.
