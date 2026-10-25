export function SplitWords({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.map((word, index) => (
    <span key={`${word}-${index}`}>
      {index > 0 ? " " : null}
      <span className="splitw">
        <span>{word}</span>
      </span>
    </span>
  ));
}
