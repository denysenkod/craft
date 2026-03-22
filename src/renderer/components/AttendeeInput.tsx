import React, { useState, useEffect, useRef } from 'react';

interface Attendee {
  email: string;
  name?: string;
  contactId?: string;
}

interface Contact {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  project: string | null;
}

interface AttendeeInputProps {
  attendees: Attendee[];
  onChange: (attendees: Attendee[]) => void;
}

export default function AttendeeInput({ attendees, onChange }: AttendeeInputProps) {
  const [inputs, setInputs] = useState<string[]>(['']);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync inputs from attendees prop on mount
  useEffect(() => {
    const vals = attendees.map((a) => a.name ? `${a.name} <${a.email}>` : a.email);
    vals.push(''); // always have an empty row at the end
    setInputs(vals);
  }, []);

  const searchContacts = async (query: string) => {
    if (query.length < 1) { setSuggestions([]); return; }
    try {
      const results = await window.api.invoke('contacts:list', { search: query }) as Contact[];
      // Filter out already-selected emails
      const selectedEmails = new Set(attendees.map((a) => a.email.toLowerCase()));
      setSuggestions(results.filter((c) => !selectedEmails.has(c.email.toLowerCase())));
    } catch {
      setSuggestions([]);
    }
  };

  const handleInputChange = (index: number, value: string) => {
    const newInputs = [...inputs];
    newInputs[index] = value;
    setInputs(newInputs);
    setActiveIndex(index);
    setHighlightIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchContacts(value), 200);
  };

  const selectContact = (index: number, contact: Contact) => {
    const newAttendees = [...attendees];
    const existing = newAttendees[index];
    if (existing) {
      newAttendees[index] = { email: contact.email, name: contact.name, contactId: contact.id };
    } else {
      newAttendees.push({ email: contact.email, name: contact.name, contactId: contact.id });
    }
    onChange(newAttendees);

    const newInputs = [...inputs];
    newInputs[index] = `${contact.name} <${contact.email}>`;
    // Add empty row if this was the last one
    if (index === newInputs.length - 1) {
      newInputs.push('');
    }
    setInputs(newInputs);
    setSuggestions([]);
    setActiveIndex(null);

    // Focus next empty row
    setTimeout(() => {
      const nextRef = inputRefs.current[index + 1];
      if (nextRef) nextRef.focus();
    }, 50);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // If dropdown is open and an item is highlighted, select it
      if (suggestions.length > 0 && highlightIndex >= 0) {
        selectContact(index, suggestions[highlightIndex]);
        return;
      }
      // Otherwise, treat as raw email entry
      const value = inputs[index].trim();
      if (value && value.includes('@')) {
        const newAttendees = [...attendees];
        if (index < newAttendees.length) {
          newAttendees[index] = { email: value, name: value.split('@')[0] };
        } else {
          newAttendees.push({ email: value, name: value.split('@')[0] });
        }
        onChange(newAttendees);

        const newInputs = [...inputs];
        if (index === newInputs.length - 1) newInputs.push('');
        setInputs(newInputs);
        setSuggestions([]);

        // Auto-create contact
        window.api.invoke('contacts:get-by-email', value).then((existing) => {
          if (!existing) {
            window.api.invoke('contacts:create', { name: value.split('@')[0], email: value });
          }
        });

        setTimeout(() => inputRefs.current[index + 1]?.focus(), 50);
      }
    } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Backspace' && inputs[index] === '' && index > 0) {
      e.preventDefault();
      removeAttendee(index);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setActiveIndex(null);
    }
  };

  const removeAttendee = (index: number) => {
    const newAttendees = attendees.filter((_, i) => i !== index);
    onChange(newAttendees);

    const newInputs = inputs.filter((_, i) => i !== index);
    if (newInputs.length === 0 || newInputs[newInputs.length - 1] !== '') {
      newInputs.push('');
    }
    setInputs(newInputs);
    setSuggestions([]);

    setTimeout(() => {
      const focusIdx = Math.max(0, index - 1);
      inputRefs.current[focusIdx]?.focus();
    }, 50);
  };

  const handleFocus = (index: number) => {
    setActiveIndex(index);
    if (inputs[index].length > 0) searchContacts(inputs[index]);
  };

  const handleBlur = () => {
    // Delay to allow click on dropdown
    setTimeout(() => {
      setActiveIndex(null);
      setSuggestions([]);
    }, 200);
  };

  return (
    <div className="flex flex-col gap-1">
      {inputs.map((value, index) => (
        <div key={index} className="relative flex gap-1">
          <input
            ref={(el) => { inputRefs.current[index] = el; }}
            className="flex-1 font-mono text-xs px-3 py-2 bg-surface-2 border border-border-base text-text-primary outline-none focus:border-honey/30"
            placeholder={index === 0 ? 'Search contacts or enter email...' : 'Add another attendee...'}
            value={value}
            onChange={(e) => handleInputChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onFocus={() => handleFocus(index)}
            onBlur={handleBlur}
          />
          {index < attendees.length && (
            <button
              onClick={() => removeAttendee(index)}
              className="px-2 text-text-muted hover:text-red-400 transition-colors text-xs"
              title="Remove"
            >
              &times;
            </button>
          )}

          {/* Dropdown */}
          {activeIndex === index && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-10 mt-0.5 bg-surface-3 border border-border-strong max-h-[180px] overflow-y-auto shadow-lg">
              {suggestions.map((contact, si) => (
                <div
                  key={contact.id}
                  className={`px-3 py-2 cursor-pointer transition-colors ${si === highlightIndex ? 'bg-honey/10' : 'hover:bg-surface-4'}`}
                  onMouseDown={(e) => { e.preventDefault(); selectContact(index, contact); }}
                  onMouseEnter={() => setHighlightIndex(si)}
                >
                  <div className="text-xs text-text-primary font-medium">{contact.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-[10px] text-text-muted">{contact.email}</span>
                    {contact.job_title && (
                      <span className="font-mono text-[10px] text-text-muted">· {contact.job_title}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
