import { DOCS_URL, GITHUB_URL } from "@/config/site";
import { contractUrl, deployment } from "@/lib/testnet";

export function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-grid">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/lockup-dark.svg" alt="Kovan" height={26} />
            <p style={{ margin: 0, maxWidth: 360 }}>On-chain spending covenants for AI agents on Stellar.</p>
            <p className="built">Built at HackMeridian 2026</p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><a href="#how">How it works</a></li>
              <li><a href="#attack">Security</a></li>
              <li><a href="#simulator">Playground</a></li>
              <li><a href="#guarantees">Guarantees</a></li>
            </ul>
          </div>
          <div>
            <h4>Verify</h4>
            <ul>
              <li><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a></li>
              <li><a href={contractUrl(deployment.pool)} target="_blank" rel="noopener noreferrer">Pool on Stellar Expert ↗</a></li>
              <li><a href={DOCS_URL} target="_blank" rel="noopener noreferrer">Docs ↗</a></li>
              <li><a href="#developers">Testnet status</a></li>
            </ul>
          </div>
        </div>
        <div className="disclaimer">
          <p>
            Public beta on Stellar testnet only. Testnet USDC has no value. Not audited. Not a financial product.
            Interactive demos on this page are simulations with illustrative values.
          </p>
          <span>© 2026 Kovan</span>
        </div>
      </div>
    </footer>
  );
}
