// Partial reimplementation of Equicord's "PolishWording" plugin
// (src/equicordplugins/polishWording/index.ts) against Hyaecord's own
// plugin API — not the original code. See PLUGIN_PARITY.md.
//
// Only the "fix apostrophes" and "expand contractions" features are
// ported (self-contained find/replace against a fixed contraction map).
// The original's "capitalize sentences" and "add periods" features use
// more involved sentence-boundary regexes; left out of this pass rather
// than risking a subtly-wrong port — a real, undisguised gap, not a fake
// toggle. Contraction map and case-preserving restore logic copied
// faithfully since they're pure data/pure functions with no UI or
// network dependency.

const CONTRACTIONS = {
  "wasn't": "was not", "can't": "cannot", "don't": "do not", "won't": "will not",
  "isn't": "is not", "aren't": "are not", "haven't": "have not", "hasn't": "has not",
  "hadn't": "had not", "doesn't": "does not", "didn't": "did not", "shouldn't": "should not",
  "wouldn't": "would not", "couldn't": "could not", "that's": "that is", "what's": "what is",
  "there's": "there is", "how's": "how is", "where's": "where is", "when's": "when is",
  "who's": "who is", "why's": "why is", "you'll": "you will", "i'll": "I will",
  "they'll": "they will", "it'll": "it will", "i'm": "I am", "you're": "you are",
  "they're": "they are", "he's": "he is", "she's": "she is", "i've": "I have",
  "you've": "you have", "we've": "we have", "they've": "they have", "you'd": "you would",
  "he'd": "he would", "she'd": "she would", "it'd": "it would", "we'd": "we would",
  "they'd": "they would", "y'all": "you all", "here's": "here is"
};

const MISSING_APOSTROPHE = {};
for (const contraction of Object.keys(CONTRACTIONS)) {
  MISSING_APOSTROPHE[contraction.replace(/'/g, "")] = contraction;
}

function getCapData(str) {
  const bits = [];
  for (const char of str) if (/[a-zA-Z]/.test(char)) bits.push(char === char.toUpperCase());
  return bits;
}

function restoreCap(str, data) {
  let result = "";
  let i = 0;
  for (const char of str) {
    if (!/[a-zA-Z]/.test(char)) {
      result += char;
      continue;
    }
    result += data[i] ? char.toUpperCase() : char.toLowerCase();
    if (i < data.length - 1) i++;
  }
  return result;
}

function ensureApostrophe(text) {
  const keys = Object.keys(MISSING_APOSTROPHE);
  if (keys.length === 0) return text;
  const re = new RegExp(`\\b(${keys.join("|")})\\b`, "gi");
  return text.replace(re, match => restoreCap(MISSING_APOSTROPHE[match.toLowerCase()], getCapData(match)));
}

function doExpandContractions(text) {
  const re = new RegExp(`\\b(${Object.keys(CONTRACTIONS).join("|")})\\b`, "gi");
  return text.replace(re, match => restoreCap(CONTRACTIONS[match.toLowerCase()], getCapData(match)));
}

definePlugin({
  name: "PolishWording",
  description: "Fixes missing apostrophes in contractions, and can expand them to full words.",
  authors: ["Samwich (Vencord)", "WKoA (Equicord)", "Hyaecord"],
  portedFrom: {
    sources: ["equicord"],
    originalName: "PolishWording",
    url: "https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/polishWording/index.ts"
  },
  settings: {
    fixApostrophes: {
      type: "boolean",
      label: "Fix apostrophes",
      description: "Ensure contractions contain apostrophes (dont -> don't).",
      default: true
    },
    expandContractions: {
      type: "boolean",
      label: "Expand contractions",
      description: "Turns contractions into full words (don't -> do not).",
      default: false
    }
  },
  start(api) {
    api.onMessageSend(content => {
      let text = content;
      if (api.settings.fixApostrophes || api.settings.expandContractions) text = ensureApostrophe(text);
      if (api.settings.expandContractions) text = doExpandContractions(text);
      return text;
    });
  }
});
