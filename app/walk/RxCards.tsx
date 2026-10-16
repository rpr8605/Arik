'use client';

import { useState } from 'react';
import type { RxOptions } from '@/lib/demo/rxOptions';
import type { RankedPathway } from '@/lib/ranking';
import type { SamplePatient } from '@/lib/demo/samples';
import { newRef, type DemoReceipt } from './demoJobs';

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Source titles are stored for maintainers. On screen they keep their
// meaning in plain words: no internal file names, no em dashes.
export function sourceLabel(title: string | null | undefined): string {
  if (!title) return 'program page';
  if (/seed_drugs\.json/i.test(title)) return 'Published list price, point in time (not yet re-checked)';
  const dash = String.fromCharCode(0x2014);
  return title.split(dash).map((s) => s.trim()).join(': ').replace(/\s+/g, ' ').trim();
}

// The best ongoing path: the engine's winner. One-time offers live in
// ranking.bridges and are shown after the ongoing options.
export function bestOngoing(data: RxOptions): RankedPathway | null {
  return data.ranking?.winner ?? data.ranking?.ranked[0] ?? null;
}

// A one-time offer (a free trial fill) is a bridge, not a monthly price,
// so it never gets a yearly figure or the "Best path" tag.
function priceLine(p: RankedPathway): string {
  if (p.oneTime) return p.monthlyCostUsd != null ? `One time only: ${usd(p.monthlyCostUsd)} for the first fill` : 'One time only';
  if (p.monthlyCostUsd == null) return 'Price: see the program terms';
  const prefix = p.priceSemantics === 'as_low_as' ? 'As low as ' : '';
  const annual = p.projectedAnnualCostUsd != null ? `, about ${usd(p.projectedAnnualCostUsd)} a year` : '';
  return `${prefix}${usd(p.monthlyCostUsd)} a month${annual}`;
}

function checked(d: string | null | undefined): string {
  if (!d) return 'date not on file';
  return `checked ${new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// The results card: Arik's real sourced options for this drug and this
// patient's situation, in the ranking engine's order. Nothing here is
// scripted; if a price isn't loaded the card says so.
export function RxResults({ data }: { data: RxOptions }) {
  const r = data.ranking;
  if (!data.found || !r || (r.ranked.length === 0 && r.bridges.length === 0 && r.pendingVerification.length === 0 && r.blocked.length === 0)) {
    return (
      <div className="rx-card">
        <p>
          Prices for <strong>{data.drug}</strong>{' '}aren&apos;t loaded in Arik&apos;s sourced data yet, so I won&apos;t guess.
        </p>
      </div>
    );
  }
  const best = bestOngoing(data);
  return (
    <div className="rx-card">
      <p className="rx-head">
        <strong>{data.drug}</strong>: options ranked by what you&apos;d really pay over the next year
      </p>
      {r.ranked.length + r.bridges.length > 0 ? (
        <ol className="rx-list">
          {[...r.ranked, ...r.bridges].map((p) => (
            <li key={p.title} className={p === best ? 'rx-best' : undefined}>
              {p === best ? <span className="tag">Best path</span> : p.oneTime ? <span className="tag">Bridge</span> : null}
              <strong>{cap(p.title)}</strong>
              <span className="rx-price">{priceLine(p)}</span>
              <span className="rx-source">
                Source:{' '}
                {p.source?.url ? (
                  <a href={p.source.url} target="_blank" rel="noopener noreferrer">
                    {sourceLabel(p.source.title)}
                  </a>
                ) : (
                  sourceLabel(p.source?.title)
                )}
                , {checked(p.source?.last_verified_at)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p>No option I can price for this situation yet.</p>
      )}
      {r.blocked.length > 0 ? (
        <div className="rx-blocked" role="note">
          <strong>Not shown on purpose:</strong> {r.blocked.map((b) => b.title).join('; ')}.{' '}
          {data.blockedReason}
        </div>
      ) : null}
      {r.pendingVerification.length > 0 ? (
        <div className="rx-pending">
          <strong>Still being checked (no price until verified):</strong>
          <ul>
            {r.pendingVerification.map((p) => (
              <li key={p.title}>
                {p.title}: {p.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.excludedPrices.length > 0 ? (
        <p className="rx-pending">Prices left out because they are out of date: {r.excludedPrices.map((e) => e.label).join('; ')}.</p>
      ) : null}
      {r.stateNote ? <p className="rx-pending">{r.stateNote.headline}</p> : null}
    </div>
  );
}

// Plain-words explanation of the best path, built in code from the
// ranking (no model call), then the call card.
export function bestPathText(data: RxOptions, sample: SamplePatient): string {
  const w = bestOngoing(data);
  const bridge = data.ranking?.bridges[0] ?? null;
  const who = sample.subject.caringFor ? `for ${sample.subject.caringFor.name}` : 'for you';
  if (!w) {
    return data.ranking?.blocked.length
      ? `The manufacturer copay card can't be used ${who} because of Medicare rules. I'm still checking the other programs for this medicine.`
      : "I don't have a verified price to point you to yet. When I do, it shows up here with its source.";
  }
  const price = w.monthlyCostUsd != null ? `, ${w.priceSemantics === 'as_low_as' ? 'as low as ' : ''}${usd(w.monthlyCostUsd)} a month` : '';
  const bridgeText = bridge ? ` ${cap(bridge.title)} can cover the first fill while you set that up.` : '';
  return `The best ongoing path ${who} right now is ${w.title}${price}.${bridgeText} Every price shows its source and the date I checked it. Next step: call the program. Here's everything you need for that call.`;
}

const INSURANCE_WORDS: Record<string, string> = {
  uninsured: 'No insurance, paying cash',
  medicare: 'Medicare Part D',
  medicaid: 'Medicaid',
  commercial: 'Plan through work',
};
const STATE_WORDS: Record<string, string> = { TX: 'Texas', FL: 'Florida', IL: 'Illinois', AZ: 'Arizona', OH: 'Ohio' };

// The call card (DEMO_DAY stage 2, lite): Call now, a fixed "Before you
// call" script in Arik's voice (English and Spanish), the details they'll
// ask for from what the patient told Arik, hours, and "Have Arik connect
// me" behind a one-tap confirm with a "Coming soon, not sent" receipt.
export function CallCard({
  data,
  sample,
  onReceipt,
}: {
  data: RxOptions;
  sample: SamplePatient;
  onReceipt: (r: DemoReceipt) => void;
}) {
  const [lang, setLang] = useState<'en' | 'es'>('en');
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState<DemoReceipt | null>(null);
  const program = data.phone?.program ?? bestOngoing(data)?.title ?? `${data.drug} savings program`;
  const caring = sample.subject.caringFor;
  const med = sample.medications.find((m) => m.drug.toLowerCase() === data.drug.toLowerCase());

  const script =
    lang === 'en'
      ? `Hi, I'm calling about the ${program}${caring ? ` for my ${caring.relationship}, ${caring.name}` : ''}. ${caring ? 'She takes' : 'I take'} ${data.drug}${med?.dose ? `, ${med.dose}` : ''}. I'd like to know if ${caring ? 'she qualifies' : 'I qualify'}, what you need from me, and how long it takes. Could you also tell me the price after enrollment?`
      : `Hola, llamo por el programa ${program}${caring ? ` para mi madre, ${caring.name}` : ''}. ${caring ? 'Ella toma' : 'Tomo'} ${data.drug}${med?.dose ? `, ${med.dose.replace('twice a day', 'dos veces al día')}` : ''}. Quisiera saber si ${caring ? 'ella califica' : 'califico'}, qué documentos necesitan y cuánto tarda. ¿Me puede decir también el precio después de inscribirme?`;

  return (
    <div className="call-card">
      <p className="call-program">
        <strong>{program}</strong>
      </p>
      {data.phone ? (
        <a className="call-now" href={`tel:${data.phone.number.replace(/[^\d+]/g, '')}`}>
          Call now: {data.phone.number}
        </a>
      ) : (
        <p className="lede">
          No program phone number on file yet.{' '}
          {bestOngoing(data)?.source?.url ? (
            <a href={bestOngoing(data)!.source!.url!} target="_blank" rel="noopener noreferrer">
              Open the program&apos;s page
            </a>
          ) : null}
        </p>
      )}
      <h3>Before you call</h3>
      <div className="lang-switch" role="group" aria-label="Script language">
        <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
          English
        </button>
        <button type="button" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>
          Español
        </button>
      </div>
      <blockquote className="call-script" lang={lang}>
        {script}
      </blockquote>
      <h4>Details they&apos;ll ask for</h4>
      <p className="fact-note">From what you told Arik. Check before you call.</p>
      <ul className="fact-list">
        <li>Medicine: {data.drug}{med?.dose ? `, ${med.dose}` : ''}</li>
        <li>Insurance: {INSURANCE_WORDS[sample.subject.insuranceType] ?? 'Not on file'}</li>
        <li>State: {STATE_WORDS[sample.subject.state] ?? sample.subject.state}</li>
        {caring ? <li>Calling for: {caring.name}, your {caring.relationship}</li> : null}
      </ul>
      <p className="fact-note">Have ready (Arik doesn&apos;t keep these):</p>
      <ul className="fact-list have-ready">
        <li>Full name and date of birth{caring ? ` (${caring.name}'s)` : ''}</li>
        <li>Prescriber&apos;s name and phone</li>
        <li>Household income, for assistance programs</li>
      </ul>
      <p className="fact-note">Hours not on file. Check the program&apos;s site.</p>
      {receipt ? (
        <div className="receipt" role="status">
          <p className="receipt-badge">Coming soon, not sent</p>
          <p>
            Recorded. Arik can&apos;t place calls yet, so{' '}
            {data.phone ? 'use Call now' : "call the number on the program's page"}. Reference {receipt.ref}, {receipt.date}.
          </p>
        </div>
      ) : confirming ? (
        <div className="confirm-box" role="group" aria-label="Confirm connect">
          <p>Arik will call {program} and connect you once someone answers. Arik never speaks as you. Go ahead?</p>
          <div className="actions">
            <button
              type="submit"
              onClick={() => {
                const r: DemoReceipt = {
                  ref: newRef(),
                  title: `Connect me to ${program}`,
                  to: program,
                  method: 'Phone',
                  date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  status: 'Coming soon, not sent',
                };
                setReceipt(r);
                onReceipt(r);
              }}
            >
              Yes, connect me
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Have Arik connect me
        </button>
      )}
    </div>
  );
}
