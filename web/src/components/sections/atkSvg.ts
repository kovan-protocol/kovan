export const atkSvg = `<svg id="atk" class="b0" viewBox="10 26 580 346" preserveAspectRatio="xMidYMid meet" fill="none">
            <!-- links -->
            <path d="M150 215 H205" stroke="#3D74FF" stroke-width="1.5" class="mov"/>
            <path d="M370 140 C 410 140, 410 72, 450 72" stroke="#2FD38A" stroke-width="1.5" opacity=".5"/>
            <!-- attack path -->
            <g data-show="0-0"><path d="M370 180 C 420 180, 410 228, 450 228" stroke="#FF5C5C" stroke-width="1.8" class="mov"/></g>
            <g data-show="1-4"><path d="M370 180 C 384 180, 388 186, 392 192" stroke="#FF5C5C" stroke-width="1.8"/>
              <g class="shield s1"><circle cx="398" cy="198" r="15" fill="#2A0E10" stroke="#FF5C5C" stroke-width="1.6"/><path d="M392 192 l12 12 M404 192 l-12 12" stroke="#FF5C5C" stroke-width="2.2" stroke-linecap="round"/></g>
              <text x="420" y="176" class="t-sm" style="fill:#FF5C5C">REJECTED</text></g>
            <!-- delegation -->
            <g data-show="2-4"><path d="M295 230 V284" stroke="#9DB5FF" stroke-width="1.5" stroke-dasharray="4 4"/><text x="302" y="262" class="t-sm">delegate</text></g>
            <g data-show="2-2"><path d="M350 320 C 420 320, 430 110, 450 90" stroke="#FF5C5C" stroke-width="1.5" class="mov"/>
              <g class="shield s2"><circle cx="402" cy="262" r="14" fill="#2A0E10" stroke="#FF5C5C" stroke-width="1.6"/><path d="M396 256 l12 12 M408 256 l-12 12" stroke="#FF5C5C" stroke-width="2.2" stroke-linecap="round"/></g>
              <text x="420" y="292" class="t-sm" style="fill:#FF5C5C">OVER CAP</text></g>
            <!-- revoke -->
            <g data-show="3-4"><path d="M140 60 C 230 60, 290 70, 292 104" stroke="#7DD3FC" stroke-width="1.6" stroke-dasharray="4 4"/><text x="170" y="52" class="t-sm" style="fill:#7DD3FC">revoke(monitor)</text></g>
            <g data-show="4-4"><path d="M218 210 C 190 250, 170 250, 150 240" stroke="#2FD38A" stroke-width="1.6" class="mov"/><text x="150" y="276" class="t-sm" style="fill:#2FD38A">return_funds</text></g>
            <!-- owner -->
            <rect x="20" y="36" width="120" height="48" rx="10" fill="#151922" stroke="rgba(255,255,255,.16)"/>
            <text x="34" y="56" class="t-lbl">OWNER</text><text x="34" y="74" class="t-name" style="font-size:12.5px">human</text>
            <!-- pool -->
            <rect x="20" y="180" width="130" height="72" rx="12" fill="#0B1430" stroke="#3D74FF" stroke-width="1.4"/>
            <text x="34" y="202" class="t-lbl" style="fill:#AFC3FF">POOL</text><text x="34" y="222" class="t-name">5.00 USDC</text><text x="34" y="240" class="t-sm">locked</text>
            <!-- monitor -->
            <rect x="205" y="104" width="180" height="128" rx="16" stroke="#3D74FF" stroke-dasharray="4 5" id="mon-box" class="fade"/>
            <text x="216" y="122" class="t-sm" style="fill:#6E95FF">covenant</text>
            <rect x="220" y="130" width="150" height="88" rx="10" fill="#151922" id="mon-fill" stroke="rgba(255,255,255,.14)"/>
            <text x="234" y="152" class="t-lbl">AGENT</text><text x="234" y="172" class="t-name">monitor</text><text x="234" y="190" class="t-sm">limit 0.50 · cap 0.10</text>
            <g data-show="0-2"><rect x="234" y="198" width="118" height="14" rx="4" fill="rgba(255,181,71,.12)"/><text x="240" y="208.5" class="t-sm" style="fill:#FFB547;font-size:9.5px">⚠ prompt injected</text></g>
            <g data-show="3-4"><rect x="234" y="198" width="88" height="14" rx="4" fill="rgba(125,211,252,.14)"/><text x="240" y="208.5" class="t-sm" style="fill:#7DD3FC;font-size:9.5px">❄ FROZEN</text></g>
            <!-- scout -->
            <g data-show="2-4">
              <rect x="235" y="284" width="120" height="76" rx="12" fill="#151922" stroke="#9DB5FF" stroke-dasharray="4 4" id="sc-box" class="fade"/>
              <rect x="236" y="285" width="118" height="74" rx="11" fill="transparent" id="sc-fill"/>
              <text x="249" y="305" class="t-lbl">CHILD</text><text x="249" y="324" class="t-name">scout</text><text x="249" y="342" class="t-sm" data-show="2-3">limit 0.25 · cap 0.05</text><text x="249" y="342" class="t-sm" style="fill:#7DD3FC" data-show="4-4">❄ frozen (parent)</text>
            </g>
            <!-- provider -->
            <rect x="450" y="44" width="130" height="56" rx="10" fill="#0D1F18" stroke="#2FD38A" stroke-opacity=".6"/>
            <text x="464" y="66" class="t-lbl" style="fill:#2FD38A">PROVIDER</text><text x="464" y="86" class="t-name" style="font-size:12.5px">allowlisted</text>
            <!-- unlisted -->
            <rect x="450" y="200" width="130" height="56" rx="10" fill="#1D0D0F" stroke="#FF5C5C" stroke-dasharray="4 4"/>
            <text x="464" y="222" class="t-lbl" style="fill:#FF5C5C">UNLISTED</text><text x="464" y="242" class="t-name" style="font-size:12.5px">GDX7…Q2LM</text>
          </svg>`;
