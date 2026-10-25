const items = ["Stellar", "Soroban", "USDC", "OpenZeppelin", "x402", "Rust"] as const;

function Row() {
  return (
    <>
      {items.map((item) => (
        <span key={item}>
          {item === "USDC" ? (
            <>
              USDC <small>SAC</small>
            </>
          ) : item === "OpenZeppelin" ? (
            <>
              OpenZeppelin <small>stellar-accounts</small>
            </>
          ) : (
            item
          )}
        </span>
      ))}
    </>
  );
}

export function StackMarquee() {
  return (
    <div className="stack" aria-label="Built on">
      <div className="lbl">Built on open infrastructure</div>
      <div className="marquee" aria-hidden>
        <Row />
        <Row />
      </div>
      <p className="sr-only">
        Built on Stellar, Soroban, USDC (Stellar Asset Contract), OpenZeppelin stellar-accounts, x402 and
        Rust. These are technologies Kovan uses, not partners.
      </p>
    </div>
  );
}
