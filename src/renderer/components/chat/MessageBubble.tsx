import React from 'react';

interface Proposal {
  proposal_id: string;
  proposal_type: 'create' | 'update';
  status: 'pending' | 'approved' | 'rejected';
  title?: string;
  description?: string;
  changes?: { title?: { old: string; new: string }; description?: { old: string; new: string } };
  reason?: string;
}

interface Props {
  role: 'user' | 'assistant';
  content: string;
  proposals?: Proposal[];
  onApprove?: (proposal: Proposal) => void;
  onReject?: (proposalId: string) => void;
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table — consecutive lines starting with |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        // Parse cells: split by |, trim, drop empty first/last
        const parseRow = (row: string) =>
          row.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

        const headerCells = parseRow(tableLines[0]);
        // Skip separator row (|---|---|)
        const isSep = (row: string) => /^\|[\s\-:|]+\|$/.test(row.trim());
        const bodyStart = isSep(tableLines[1]) ? 2 : 1;
        const bodyRows = tableLines.slice(bodyStart).map(parseRow);

        elements.push(
          <div key={`tbl-${i}`} style={{ margin: '8px 0', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr>
                  {headerCells.map((cell, ci) => (
                    <th key={ci} style={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      borderBottom: '1px solid rgba(255,255,255,0.15)',
                      fontWeight: 600,
                      fontSize: '11px',
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.05em',
                      color: 'rgba(255,255,255,0.5)',
                    }}>
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: '6px 10px',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
      // If only 1 line with pipes, fall through to paragraph
      i -= tableLines.length;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />);
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = { 1: '16px', 2: '15px', 3: '14px' } as Record<number, string>;
      elements.push(
        <div key={i} style={{ fontSize: sizes[level], fontWeight: 600, margin: '12px 0 4px' }}>
          {renderInline(headingMatch[2])}
        </div>
      );
      i++;
      continue;
    }

    // Bullet list — collect consecutive lines
    if (/^\s*[-*]\s+/.test(line)) {
      const items: { text: string; key: number }[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^\s*[-*]\s+/, ''), key: i });
        i++;
      }
      elements.push(
        <ul key={`ul-${items[0].key}`} style={{ margin: '4px 0', paddingLeft: '18px', listStyle: 'disc' }}>
          {items.map(item => (
            <li key={item.key} style={{ marginBottom: '2px' }}>{renderInline(item.text)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: { text: string; key: number }[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^\s*\d+[.)]\s+/, ''), key: i });
        i++;
      }
      elements.push(
        <ol key={`ol-${items[0].key}`} style={{ margin: '4px 0', paddingLeft: '18px' }}>
          {items.map(item => (
            <li key={item.key} style={{ marginBottom: '2px' }}>{renderInline(item.text)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={`code-${i}`} style={{
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '8px',
          padding: '10px 12px',
          margin: '6px 0',
          fontSize: '12px',
          fontFamily: 'monospace',
          overflowX: 'auto',
          whiteSpace: 'pre',
        }}>
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }

    // Empty line — spacing
    if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: '8px' }} />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(<p key={i} style={{ margin: '2px 0' }}>{renderInline(line)}</p>);
    i++;
  }

  return elements;
}

function renderInline(text: string): React.ReactNode {
  // Process bold, italic, inline code
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|(__(.+?)__)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(<strong key={key++} style={{ fontWeight: 600 }}>{match[2]}</strong>);
    } else if (match[4]) {
      // `inline code`
      parts.push(
        <code key={key++} style={{
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '4px',
          padding: '1px 5px',
          fontSize: '12px',
          fontFamily: 'monospace',
        }}>
          {match[4]}
        </code>
      );
    } else if (match[6]) {
      // __bold__
      parts.push(<strong key={key++} style={{ fontWeight: 600 }}>{match[6]}</strong>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : parts;
}

export default function MessageBubble({ role, content, proposals, onApprove, onReject }: Props) {
  const isUser = role === 'user';
  const pendingProposals = proposals?.filter(p => p.status === 'pending') || [];
  const resolvedProposals = proposals?.filter(p => p.status !== 'pending') || [];
  const hasPending = pendingProposals.length > 0;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
     <div className="flex flex-col items-end max-w-[85%]">
      <div
        className={`overflow-hidden ${hasPending ? 'proposal-glow' : ''}`}
        style={{
          background: isUser ? '#E8A838' : '#1C1C22',
          color: isUser ? '#07070A' : '#F0EDE8',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        }}
      >
        {/* Message text */}
        <div className="px-4 py-3 text-[13px] leading-relaxed">
          {isUser ? content : renderMarkdown(content)}
        </div>

        {/* Resolved proposals — small inline status */}
        {resolvedProposals.map(p => (
          <div key={p.proposal_id} className="px-4 pb-2 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${p.status === 'approved' ? 'bg-green-400' : 'bg-red-400/60'}`} />
            <span className="text-[11px] opacity-50">
              {p.status === 'approved' ? 'Approved' : 'Rejected'}
            </span>
          </div>
        ))}

      </div>

      {/* Pending proposals — small pill buttons below the bubble, right-aligned */}
      {hasPending && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <button
            onClick={() => pendingProposals.forEach(p => onReject?.(p.proposal_id))}
            className="px-3 py-1 rounded-full text-[11px] font-medium text-text-muted hover:text-red-400 border border-border-strong bg-surface-2 transition-colors"
          >
            Reject
          </button>
          <button
            onClick={() => pendingProposals.forEach(p => onApprove?.(p))}
            className="px-3 py-1 rounded-full text-[11px] font-semibold text-surface-0 bg-honey hover:bg-honey-dim transition-colors"
          >
            Accept
          </button>
        </div>
      )}
     </div>

      <style>{`
        @keyframes proposalPulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(232, 168, 56, 0.3), 0 0 8px rgba(232, 168, 56, 0.1); }
          50% { box-shadow: 0 0 0 1.5px rgba(232, 168, 56, 0.6), 0 0 20px rgba(232, 168, 56, 0.2); }
        }
        .proposal-glow {
          animation: proposalPulse 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
