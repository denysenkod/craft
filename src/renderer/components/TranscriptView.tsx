import React from 'react';

interface TranscriptViewProps {
  onOpenChat: () => void;
}

const TRANSCRIPT = [
  { time: '0:00', speaker: 'You', text: "Thanks for joining, Sarah. I'd love to hear about how you onboard new enterprise customers today." },
  { time: '0:12', speaker: 'Sarah', text: "Sure! So right now our onboarding is... honestly kind of a mess. We have a 14-step process documented in Notion but nobody actually follows it. Each account manager sort of does their own thing.", guest: true },
  { time: '0:35', speaker: 'You', text: 'Can you walk me through what happened with your last enterprise customer?' },
  { time: '0:42', speaker: 'Sarah', text: "Yeah, so Acme Corp came in — $200K ARR deal. We were supposed to get them live in two weeks. It took six. The main issue was data migration. They had everything in Salesforce and our import tool kept choking on custom fields. We lost a weekend because the migration failed silently — no error messages, just blank data. Our engineering team had to manually fix 4,000 records.", guest: true },
  { time: '1:28', speaker: 'You', text: 'That sounds painful. How did the customer react?' },
  { time: '1:33', speaker: 'Sarah', text: "They were furious. Their VP of Sales actually emailed our CEO directly. Said they were evaluating HubSpot as a backup. We almost lost them. The only reason they stayed is we gave them three months free and assigned a dedicated engineer for a week.", guest: true },
  { time: '2:05', speaker: 'You', text: 'What would have made that experience different?' },
  { time: '2:10', speaker: 'Sarah', text: "Honestly? A proper data validation step before we even attempt migration. Let us preview what's going to happen, see which fields map correctly, flag the ones that don't. And real-time progress — I was literally refreshing a page for hours not knowing if it was working or broken. Also, the rollback story is terrible. When something breaks, we should be able to undo it cleanly.", guest: true },
  { time: '2:48', speaker: 'You', text: 'Are there other tools you\'ve seen handle this well?' },
  { time: '2:53', speaker: 'Sarah', text: "Stripe's migration tooling is great. They have this dry-run mode where you can see exactly what will happen. And Intercom — their import tool shows you a preview with validation errors inline. We should steal both of those ideas honestly.", guest: true },
];

const ANALYSIS = {
  summary: [
    'Enterprise onboarding is broken — 14-step process not followed',
    'Data migration is the #1 bottleneck — Salesforce custom fields fail silently',
    'Almost lost $200K ARR customer due to 4-week delay',
    'Key asks: validation, progress tracking, rollback',
  ],
  painPoints: [
    { text: 'Silent migration failures on Salesforce custom fields', ref: '"the migration failed silently — no error messages, just blank data"' },
    { text: 'No migration progress visibility', ref: '"I was literally refreshing a page for hours"' },
    { text: 'No rollback capability', ref: '"the rollback story is terrible"' },
    { text: 'Inconsistent onboarding process', ref: '"nobody actually follows it"' },
  ],
  quotes: [
    { text: '"The migration failed silently — no error messages, just blank data. Our engineering team had to manually fix 4,000 records."', speaker: 'Sarah Chen' },
    { text: '"Their VP of Sales actually emailed our CEO directly."', speaker: 'Sarah Chen' },
    { text: '"Stripe\'s migration tooling is great. They have this dry-run mode."', speaker: 'Sarah Chen' },
  ],
  competitors: [
    { name: 'HubSpot', text: 'Customer threatened to switch during delayed onboarding' },
    { name: 'Stripe', text: 'Dry-run migration mode cited as best-in-class' },
    { name: 'Intercom', text: 'Import tool with inline validation errors praised' },
  ],
  sentiment: [
    { type: 'negative' as const, text: 'Frustration about silent failures and lack of visibility' },
    { type: 'negative' as const, text: 'Anxiety about churn — CEO escalation' },
    { type: 'positive' as const, text: 'Clear vision of "good" via Stripe/Intercom examples' },
  ],
};

function Section({ title, count, children, defaultOpen = true }: { title: string; count: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-border-base">
      <button onClick={() => setOpen(!open)} className="w-full px-6 py-3.5 flex items-center justify-between hover:bg-surface-3 transition-colors">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-primary">{title}</span>
        <span className="font-mono text-[10px] text-text-muted">{count}</span>
      </button>
      {open && <div className="px-6 pb-5">{children}</div>}
    </div>
  );
}

export default function TranscriptView({ onOpenChat }: TranscriptViewProps) {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Transcript Pane */}
      <div className="flex-1 flex flex-col border-r border-border-base min-w-0">
        <div className="px-7 py-4 border-b border-border-base flex items-center justify-between shrink-0 bg-surface-0">
          <div>
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Transcript</div>
            <div className="text-[15px] font-medium text-text-primary mt-0.5">Enterprise Onboarding — Sarah Chen</div>
          </div>
          <button onClick={onOpenChat} className="font-mono text-[10px] font-medium px-2.5 py-1.5 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">
            Chat &rarr;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {TRANSCRIPT.map((line, i) => (
            <div key={i} className="flex px-7 py-3.5 border-b border-border-base hover:bg-surface-2 transition-colors">
              <span className="font-mono text-[10px] text-text-muted min-w-[44px] pt-0.5">{line.time}</span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider min-w-[72px] pt-0.5" style={{ color: line.guest ? '#6BA8E8' : '#E8A838' }}>{line.speaker}</span>
              <span className="text-sm leading-relaxed text-text-secondary flex-1">{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Analysis Pane */}
      <div className="w-[400px] flex flex-col overflow-hidden bg-surface-2 shrink-0">
        <div className="px-6 py-4 border-b border-border-base flex items-center justify-between bg-surface-0">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Analysis</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-green-400">&#10003; Complete</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Section title="Summary" count={ANALYSIS.summary.length}>
            <ul className="list-none">
              {ANALYSIS.summary.map((s, i) => (
                <li key={i} className="text-[13px] text-text-secondary leading-relaxed py-2 pl-4 border-b border-border-base last:border-b-0 relative">
                  <span className="absolute left-0 text-honey">&mdash;</span>
                  {s}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Pain Points" count={ANALYSIS.painPoints.length}>
            {ANALYSIS.painPoints.map((p, i) => (
              <div key={i} className="border border-border-base bg-surface-3 p-3.5 mb-2 hover:border-honey/30 transition-colors">
                <div className="text-[13px] text-text-primary leading-snug mb-1.5">{p.text}</div>
                <div className="text-[13px] italic text-text-muted" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>{p.ref}</div>
                <button className="mt-2.5 font-mono text-[10px] font-medium text-honey uppercase tracking-wider underline underline-offset-2 hover:text-honey-dim">+ Create Task</button>
              </div>
            ))}
          </Section>
          <Section title="Key Quotes" count={ANALYSIS.quotes.length}>
            {ANALYSIS.quotes.map((q, i) => (
              <div key={i} className="border-l-2 border-honey pl-5 mb-5">
                <div className="text-base italic text-text-primary leading-snug" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>{q.text}</div>
                <div className="font-mono text-[10px] text-text-muted mt-2 uppercase tracking-wider">— {q.speaker}</div>
              </div>
            ))}
          </Section>
          <Section title="Competitors" count={ANALYSIS.competitors.length}>
            {ANALYSIS.competitors.map((c, i) => (
              <div key={i} className="border border-border-base bg-surface-3 p-3.5 mb-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 bg-honey text-surface-0 inline-block mb-2">{c.name}</span>
                <div className="text-[13px] text-text-primary">{c.text}</div>
              </div>
            ))}
          </Section>
          <Section title="Sentiment" count={ANALYSIS.sentiment.length}>
            {ANALYSIS.sentiment.map((s, i) => (
              <div key={i} className="border border-border-base bg-surface-3 p-3.5 mb-2">
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: s.type === 'negative' ? '#E87B6B' : '#5CC9A0' }}>
                  {s.type === 'negative' ? '▼ ' : '▲ '}{s.type}
                </span>
                <div className="text-[13px] text-text-primary">{s.text}</div>
              </div>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}
