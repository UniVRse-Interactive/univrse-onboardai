// Presentation only: keep every word of the answer and never invent a task,
// policy, time, or completion signal from a user's reading interactions.
export function visualAnswer(message) {
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  if (!text) return null;
  const grounded =
    message.mode !== 'demo' && Array.isArray(message.passages) && message.passages.length > 0;
  const example = message.learning?.format === 'example';
  let kind = 'reply',
    items = [text];
  if (grounded) {
    const markers = [...text.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+/g)];
    const ordered =
      markers.length > 1 &&
      markers.length <= 8 &&
      markers[0].index === 0 &&
      markers.every((m, i) => Number(m[1]) === i + 1);
    if (ordered) {
      items = markers.map((m, i) =>
        text.slice(m.index + m[0].length, markers[i + 1]?.index ?? text.length).trim(),
      );
      // A numbered list of facts is still a set of facts. Show a task flow
      // only when each item is phrased as an explicit action.
      kind = items.every((body) =>
        /^(?:Please\s+)?(?:Ask|Open|Send|Prepare|Ensure|Check|Submit|Claim|Read|Complete|Attend|Log|Sign|Go|Visit|Create|Share|Keep|Confirm|Contact|Review|Bring|Download|Upload|Fill|Select|Choose|Wait|Write|Add|Set|Update|Report|Use|Follow|Schedule|Request|Join|Inform|Be|Register|Meet)\b/i.test(
          body,
        ),
      )
        ? 'steps'
        : example
          ? 'example'
          : 'points';
    } else {
      kind = example ? 'example' : 'points';
      const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
      const parts =
        paragraphs.length > 1
          ? paragraphs
          : text.split(/(?<=[.!?])\s+(?=[A-Z“"\d])/).filter(Boolean);
      if (parts.length <= 6) items = parts;
    }
  }
  return {
    text,
    kind,
    example,
    grounded,
    items: items.map((body, index) => ({
      body,
      index,
      label: visualLabel(body),
      icon: visualIcon(body),
      ...visualSubject(body),
      plain: grounded ? simpleAnswer(body) : body,
    })),
  };
}

// Topic labels and artwork describe the words in the answer. They do not
// determine permission, eligibility, task completion, or employee ability.
function visualSubject(text) {
  const times = [
    ...new Set(text.match(/\b\d{1,2}(?:[.:]\d{2})?\s*(?:[ap]\.m\.?|[ap]m)(?![a-z])/gi) || []),
  ].slice(0, 4);
  if (
    /\b(work updates?|progress reports?)\b/i.test(text) &&
    /\b(prepare|share|submit|include)\b/i.test(text)
  )
    return { scene: 'document', title: 'Prepare your update' };
  if (/\bEnglish\b/i.test(text) && /\b(communicate|use|required)\b/i.test(text))
    return { scene: 'conversation', title: 'Meeting language', tag: 'English' };
  if (
    /\b(round table|discussion)\b/i.test(text) &&
    /\b(questions?|suggestions?|issues?|challenges?)\b/i.test(text)
  )
    return { scene: 'conversation', title: 'Questions & ideas' };
  if (
    /\b(HR|Human Resources)\b/i.test(text) &&
    /\b(confirm|check|contact|ask|details)\b/i.test(text)
  )
    return { scene: 'people', title: 'Check with HR' };
  if (/\b(receipts?|mileage|claim)\b/i.test(text))
    return {
      scene: 'document',
      title: /\b(mileage)\b/i.test(text) ? 'Mileage guidance' : 'Receipts & claims',
    };
  if (/\b(wear|clothing|shirts?|jeans|pants|slippers|dress code|dress guidance)\b/i.test(text)) {
    const clothes = [];
    if (/\bcollared\b/i.test(text)) clothes.push('collared');
    else if (/\b(?:t-?shirts?|shirts?)\b/i.test(text)) clothes.push('shirt');
    if (/\bjeans\b/i.test(text)) clothes.push('jeans');
    if (/\bshort (?:hot )?pants\b/i.test(text)) clothes.push('shorts');
    if (/\bslippers\b/i.test(text)) clothes.push('slippers');
    const names = {
      collared: 'Collared T-shirts',
      shirt: 'T-shirts',
      jeans: 'Jeans',
      shorts: 'Short pants',
      slippers: 'Slippers',
    };
    return {
      scene: 'clothing',
      title: /\b(not allowed|not permitted|prohibited)\b/i.test(text)
        ? /\bweekdays\b/i.test(text)
          ? 'Weekday restrictions'
          : 'Clothing restrictions'
        : clothes.length === 1
          ? names[clothes[0]]
          : 'Clothing rules',
      clothes: clothes.slice(0, 3),
      ripped: /\bripped jeans\b/i.test(text),
    };
  }
  if (
    times.length ||
    /\b(working hours|office hours|hours of work|work schedule|breaks?)\b/i.test(text)
  )
    return {
      scene: 'time',
      title: /\b(vary|discretion|changes?)\b/i.test(text)
        ? 'Schedule changes'
        : /\bOn Fridays?\b/i.test(text) && /\b(lunch|break)\b/i.test(text)
          ? 'Friday breaks'
          : 'Hours & schedule',
      times,
    };
  if (
    /\b(virtual reality|augmented reality|gamification|metaverses?)\b/i.test(text) &&
    /\b(focus|company|UniVRse|develop|speciali[sz])\b/i.test(text)
  )
    return { scene: 'company', title: 'What the company does' };
  if (/\b(virtual|3D)\b/i.test(text) && /\b(events?|world)\b/i.test(text))
    return { scene: 'company', title: 'Virtual experiences' };
  if (/\b(meetings?|agenda)\b/i.test(text)) return { scene: 'meeting', title: 'Meeting guidance' };
  if (/\b(apps?|email|laptop|software|password|login|log in|sign in)\b/i.test(text))
    return { scene: 'computer', title: 'Tools & access' };
  if (/\b(manager|team|people|HR|human resources)\b/i.test(text))
    return { scene: 'people', title: 'People & support' };
  return { scene: 'document', title: visualLabel(text) };
}

export function simpleAnswer(text) {
  // Narrow, complete grammatical rewrites only. Unrecognised policy wording
  // stays intact; never clip a sentence or drop a qualification for brevity.
  if (
    /^If you need more specific details about company operations, please confirm with the Human Resources Department\.$/i.test(
      text,
    )
  )
    return 'For more company details, check with HR.';
  if (
    /\b(only|unless|except|before|after|without|not|approval|if|provided that|as long as)\b/i.test(
      text,
    )
  )
    return text;
  return text
    .replace(
      /^Ensure you communicate in (\w+), as all participants are required to use \1 throughout the meeting\.$/i,
      'Use $1 throughout the meeting.',
    )
    .replace(/^Prepare your (.+) to share during the (.+)\.$/i, 'Prepare your $1 for the $2.')
    .replace(
      /^Be ready to participate in the round table discussion by bringing up any (.+)\.$/i,
      'Bring $1 to the round table discussion.',
    )
    .replace(/^As part of its business activities, UniVRse provides /, 'UniVRse provides ')
    .replace(/^UniVRse Interactive Sdn Bhd focuses on /, 'UniVRse focuses on ');
}

function visualIcon(text) {
  if (/\b(wear|clothing|shirts?|t-shirts?|jeans|pants|slippers|dress)\b/i.test(text))
    return 'shirt';
  if (/\b(hours?|time|morning|daily)\b/i.test(text)) return 'clock';
  if (/\b(meetings?|events?|calendar)\b/i.test(text)) return 'calendar';
  if (/\b(wear|clothing|shirts?|dress)\b/i.test(text)) return 'shirt';
  if (/\b(receipts?|reports?|claims?)\b/i.test(text)) return 'receipt';
  if (/\b(apps?|email|laptop|software|password|login)\b/i.test(text)) return 'laptop';
  if (/\b(HR|manager|team|people|human resources)\b/i.test(text)) return 'people';
  if (/\b(chat|communicate|discussion|English)\b/i.test(text)) return 'chat';
  return 'book';
}

export function visualLabel(text) {
  const words = text.trim().split(/\s+/),
    label = words.slice(0, 7).join(' ');
  return label.length > 56
    ? label.slice(0, 53).trimEnd() + '…'
    : words.length > 7
      ? label + '…'
      : label;
}
