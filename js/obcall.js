// Content for the OB Call tab: the Wombkeepers first-call phone reference
// (2026-09-16_OB_First_Call_Guide_v1.pdf), kept verbatim — it was written for
// phone triage, so the wording and thresholds are not to be edited here.
// Pure data, no DOM; tests/obcall.test.js imports it directly.
//
// Inline markup the renderer understands:
//   **bold**        «spoken line, italic»        {color} {amount} → filled from fields
//
// Block types:  text · quote (checkable script) · item (checkbox, optional fields)
export const OB_CALL = {
  source: '2026-09-16_OB_First_Call_Guide_v1.pdf',
  title: 'First Call with Wombkeepers',
  sub: 'Phone reference for Staci · Wednesday, September 16, 2026',

  facts: {
    title: `Your facts (they'll ask for these)`,
    rows: [
      { k: 'Last period', v: `August 3, 2026 → about **{gestation}** today` },
      { k: 'Est. due date', v: `May 11, 2027 (home tests positive; not yet seen by a provider)` },
      { k: 'History', v: `First pregnancy. No prior losses.` },
      { k: 'Insurance', v: `Banner|Aetna (Staci is the patient — her plan governs)` },
      { k: 'Current supplements', v: `Thorne prenatal, DHA, vitamin D+K, magnesium. Paused pending your OK: Fertility Support blend, mushroom-coffee adaptogens.` },
    ],
  },

  sections: [
    {
      id: 's1', step: 'STEP 1', title: 'Report symptoms first, before scheduling',
      blocks: [
        { type: 'text', text: `Say this up front — don't wait for the scheduling questions:` },
        {
          type: 'quote', id: 'q-s1', check: 'Said it',
          text: `“Before we schedule — I need to report symptoms. I'm about 6 weeks pregnant, last period August 3rd. **Yesterday morning I had light spotting and mild cramping. It stopped for several hours, then came back mildly.** The cramping is twinges — not like period cramps, and not one-sided. The spotting is {color} and {amount}. No tissue or clots, no dizziness, no shoulder pain.”`,
          fill: { color: 'spot-color', amount: 'spot-amount' },
          blank: { color: '[color]', amount: '[amount — wiping only / pantyliner]' },
        },
        { type: 'text', text: `Fill in before dialing — status **right now**:` },
        {
          type: 'item', id: 's1-status',
          fields: [
            { id: 'spot-color', label: 'Color now:', options: ['pink', 'brown', 'red'] },
            { id: 'spot-amount', label: 'Amount:', options: ['wiping only', 'pantyliner', 'pad'] },
          ],
        },
        {
          type: 'item', id: 's1-trend',
          fields: [{ id: 'spot-trend', label: 'Trend since yesterday:', options: ['better', 'same', 'building'] }],
        },
        {
          type: 'item', id: 's1-trigger', text: `Anything before it started (sex, exercise, straining)?`,
          fields: [{ id: 'trigger', placeholder: 'what came before it' }],
        },
      ],
    },
    {
      id: 's2', step: 'STEP 2', title: 'What to ask for, given the spotting',
      blocks: [
        {
          type: 'quote', id: 'q-s2', check: 'Asked',
          text: `“Given the spotting, can we be seen sooner for an ultrasound and possibly labs, rather than waiting for the standard 8–10 week visit?”`,
        },
        {
          type: 'item', id: 's2-early', text: `If they bring you in early: take the earliest slot. Write it here:`,
          fields: [{ id: 'early-slot', placeholder: 'date & time of the early visit' }],
        },
        { type: 'item', id: 's2-wait', text: `If they say wait: «“What changes that — what should make us call back or come in?”»` },
        {
          type: 'item', id: 's2-nurse', text: `Ask: “Do you have a nurse line we can call if anything changes tonight?”`,
          fields: [{ id: 'nurse-line', label: '#:', tel: true, placeholder: 'nurse line number' }],
        },
      ],
    },
    {
      id: 's3', step: 'STEP 3', title: 'Book the first visit',
      blocks: [
        {
          type: 'item', id: 's3-visit', text: `First prenatal visit date & time (target: weeks 8–10, late Sept–mid Oct):`,
          fields: [{ id: 'first-visit', placeholder: 'date & time' }],
        },
        { type: 'item', id: 's3-what', text: `What happens at that visit — dating ultrasound? bloodwork? exam?` },
        { type: 'item', id: 's3-long', text: `How long is the appointment; should Q come; anything to bring?` },
      ],
    },
    {
      id: 's4', step: 'STEP 4', title: 'Intake & logistics questions',
      blocks: [
        { type: 'item', id: 's4-insurance', text: `Do you take Banner|Aetna? Are the practice **and** the Renewal Center for Birth in-network?` },
        { type: 'item', id: 's4-fee', text: `Global fee / billing structure: what's the all-in cost estimate, what does insurance typically cover, payment plan options? (feeds our open-enrollment decision — ask for it in writing)` },
        { type: 'item', id: 's4-care', text: `Care model: who do we see — midwife, OB, or team? Same person at delivery?` },
        { type: 'item', id: 's4-supplements', text: `Supplements: OK to continue prenatal, DHA, D+K, magnesium? Confirm dropping the fertility blend and adaptogen coffee.` },
        { type: 'item', id: 's4-avoid', text: `Anything Staci should do or avoid between now and the first visit?` },
      ],
    },
    {
      id: 'nice', optional: true, title: `If there's time — nice-to-haves (can wait for the visit)`,
      blocks: [
        { type: 'item', id: 'n-natural', text: `Their approach to natural birth support at the birth center` },
        { type: 'item', id: 'n-doula', text: `In-house doula program — how and when to sign up` },
        { type: 'item', id: 'n-portal', text: `Portal / paperwork to complete before the first visit` },
      ],
    },
  ],

  er: {
    title: `Go to the ER now — don't wait for a callback — if any of these happen:`,
    items: [
      `Soaking a full pad in an hour, or clots bigger than a quarter`,
      `Severe pain, or pain that's sharp and one-sided`,
      `Shoulder pain, dizziness, or feeling faint`,
      `Fever over 100.4°F`,
    ],
  },

  footer: `Steady context: stop-and-start light spotting with twinges at 6 weeks is one of the most common presentations there is, and most end in a normal ultrasound. You're calling to be thorough, not because something is wrong.`,
};
