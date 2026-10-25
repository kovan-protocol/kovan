export const howSvg = `<svg id="howsvg" data-step="1" viewBox="0 0 520 400" fill="none">
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#3D74FF"/></marker>
            <marker id="ahg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#2FD38A"/></marker>
          </defs>
          <!-- s1 lines -->
          <g class="s1">
            <path class="flow" d="M90 74 V182" stroke="#3D74FF" stroke-width="1.6" marker-end="url(#ah)"/>
            <path class="flow" d="M150 52 H280 V150" stroke="#3D74FF" stroke-width="1.6" marker-end="url(#ah)"/>
            <text x="100" y="134" fill="#8F98A6" font-family="JetBrains Mono" font-size="10.5">fund()</text>
            <text x="172" y="44" fill="#8F98A6" font-family="JetBrains Mono" font-size="10.5">create_agent(covenant)</text>
          </g>
          <!-- s2 lines -->
          <g class="s2">
            <path class="flow" d="M162 236 H206" stroke="#3D74FF" stroke-width="1.6" marker-end="url(#ah)"/>
            <text x="166" y="226" fill="#8F98A6" font-family="JetBrains Mono" font-size="10.5">draw</text>
            <path class="flow" d="M352 196 C 390 196, 380 120, 392 120" stroke="#2FD38A" stroke-width="1.6" marker-end="url(#ahg)"/>
            <text x="360" y="160" fill="#2FD38A" font-family="JetBrains Mono" font-size="10.5">x402 pay</text>
          </g>
          <!-- s3 -->
          <g class="s3">
            <path d="M352 268 C 372 268, 372 300, 380 312" stroke="#FF5C5C" stroke-width="1.6" stroke-dasharray="4 5"/>
            <circle cx="384" cy="318" r="13" fill="#2A0E10" stroke="#FF5C5C" stroke-width="1.5"/>
            <path d="M379 313 l10 10 M389 313 l-10 10" stroke="#FF5C5C" stroke-width="2" stroke-linecap="round"/>
            <text x="300" y="370" fill="#FF5C5C" font-family="JetBrains Mono" font-size="10.5">rejected by covenant policy</text>
          </g>
          <!-- owner -->
          <g><rect x="24" y="28" width="126" height="46" rx="10" fill="#151922" stroke="rgba(255,255,255,.16)"/>
          <text x="40" y="49" fill="#8F98A6" font-family="JetBrains Mono" font-size="10" letter-spacing="1">OWNER</text>
          <text x="40" y="65" fill="#ECEFF4" font-family="Manrope" font-weight="700" font-size="13">configures</text></g>
          <!-- pool -->
          <g><rect x="24" y="186" width="138" height="100" rx="12" fill="#0B1430" stroke="#3D74FF" stroke-width="1.4"/>
          <text x="40" y="208" fill="#AFC3FF" font-family="JetBrains Mono" font-size="10" letter-spacing="1">KOVAN-POOL</text>
          <text x="40" y="228" fill="#ECEFF4" font-family="Manrope" font-weight="700" font-size="14">USDC locked</text>
          <rect x="40" y="244" width="106" height="10" rx="3" fill="rgba(255,255,255,.06)"/>
          <rect x="40" y="244" width="44" height="10" rx="3" fill="#3D74FF"/><rect x="86" y="244" width="30" height="10" rx="3" fill="#6E95FF"/><rect x="118" y="244" width="18" height="10" rx="3" fill="#AFC3FF"/>
          <text x="40" y="272" fill="#8F98A6" font-family="JetBrains Mono" font-size="9.5">Σ limits ≤ locked</text></g>
          <!-- agent wallet with covenant -->
          <g><rect x="208" y="150" width="144" height="136" rx="14" fill="none" stroke="#3D74FF" stroke-dasharray="3 4" opacity=".7"/>
          <rect x="220" y="162" width="120" height="112" rx="10" fill="#151922" stroke="rgba(255,255,255,.16)"/>
          <text x="232" y="182" fill="#8F98A6" font-family="JetBrains Mono" font-size="10" letter-spacing="1">AGENT WALLET</text>
          <text x="232" y="200" fill="#ECEFF4" font-family="Manrope" font-weight="700" font-size="13">OZ smart account</text>
          <rect x="232" y="212" width="96" height="48" rx="7" fill="#0B1430" stroke="rgba(61,116,255,.6)"/>
          <text x="240" y="228" fill="#AFC3FF" font-family="JetBrains Mono" font-size="9.5">covenant</text>
          <text x="240" y="242" fill="#8F98A6" font-family="JetBrains Mono" font-size="9">payees · caps</text>
          <text x="240" y="254" fill="#8F98A6" font-family="JetBrains Mono" font-size="9">calls · expiry</text></g>
          <!-- provider -->
          <g class="s2"><rect x="396" y="92" width="112" height="56" rx="10" fill="#0D1F18" stroke="#2FD38A" stroke-opacity=".6"/>
          <text x="410" y="113" fill="#2FD38A" font-family="JetBrains Mono" font-size="10" letter-spacing="1">PROVIDER</text>
          <text x="410" y="132" fill="#ECEFF4" font-family="Manrope" font-weight="700" font-size="12.5">allowlisted</text></g>
          <!-- unlisted -->
          <g class="s3"><rect x="396" y="292" width="112" height="56" rx="10" fill="#1D0D0F" stroke="#FF5C5C" stroke-dasharray="4 4"/>
          <text x="410" y="313" fill="#FF5C5C" font-family="JetBrains Mono" font-size="10" letter-spacing="1">UNLISTED</text>
          <text x="410" y="332" fill="#ECEFF4" font-family="Manrope" font-weight="700" font-size="12.5">new address</text></g>
        </svg>`;
