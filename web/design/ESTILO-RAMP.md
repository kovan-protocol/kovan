# Estilo Ramp → Kovan · notas para portar

Referencia: `../ref/ramp/ANALISIS.md` (con capturas en `../ref/ramp/`). Mockup: `hero-dashboard.html`.
Tomamos de Ramp el **ritmo, la jerarquía y el movimiento**. No copiamos su marca: ni la fuente Lausanne, ni el lima, ni sus textos, fotos, logos de clientes, testimonios o métricas.

## Tipografía (escala en desktop, 1440)
| Uso | Fuente | Tamaño / interlineado | Tracking |
|---|---|---|---|
| H1 hero | Manrope 800 | clamp(42px, 6.4vw, 92px) / 1.0 | -.035em |
| H2 de sección | Manrope 800 | 48 / 1.04 (en móvil, 32–34) | -.035em |
| H3 de card | Manrope 800 | 24 / 1.17 (en móvil, 21) | -.025em |
| Subtítulo | Manrope 700 | 22–26 / 1.25 | -.02em |
| Texto | Inter 400 | 15–17 / 1.5, color `#5B6270` | 0 |
| Eyebrow / tags | JetBrains Mono 500 | 10–11 en MAYÚSCULAS | .1–.12em |
| Números (KPIs, montos) | JetBrains Mono 500 con `tabular-nums` | 22 en KPI, 12.5 en filas | -.02em |

- **Titular a dos tonos**, el patrón clave de Ramp: primera frase en tinta `#0E1116` y el resto en gris `#7C838E` dentro de un `<span>`. Por ejemplo: «Three moves. *One of them is a no.*»
- Pocos pesos: 800 en display y 400/500 en texto. Nada de cursivas.

## Espaciado y grid
- Contenedor de 1200px como máximo, con gutter de 24px (16px en móvil).
- Secciones con padding vertical de 120–140px en desktop y 72–88px en móvil. Mucho aire: nunca más de un bloque denso por pantalla.
- Escala de 4/8: gap de 16 en bentos y cards, padding de 28 en las cards (20 en móvil) y 14–18 dentro de los paneles de la UI.
- Bento de 5 columnas, con cards que ocupan 2 o 3 (`span 2/3`). Pasa a 2 columnas a 1080px y a 1 columna a 600px.
- Radios: 16 en el stage, 12 en ventanas y cards, 10 en paneles internos, 7 en botones y 99 en chips.
- Breakpoints: 1080 (se ocultan el sidebar y la card flotante izquierda), 860 (todo se apila y el toast pasa a flujo normal), 600 (KPIs en 2×2) y 768 (touch targets ≥ 44px).

## Color
- Superficie clara y cálida: bg `#FBFBFA`, stone `#F3F3F1` para paneles y stage, líneas `#E6E6E1` / `#D9D9D3`, blanco para las ventanas.
- **Un solo acento**: el azul de marca `#014CFE`, en el CTA primario, las barras y los chips «testnet» (`#EAF0FF` sobre `#0039C4`). El negro `#0E1116` es el CTA secundario, como en Ramp.
- Para los estados sobre fondo claro usar las variantes con contraste AA: ok `#0E7A4C` sobre `#E8F7EF` y deny `#C62828` sobre `#FDECEC`. Los neón de marca (`#2FD38A` y `#FF5C5C`) quedan solo para puntos y bandas oscuras.
- La banda oscura (ataque, código, footer) usa `#0E1116` con azul `#6E95FF` para el texto.

## Hero dashboard (patrón «stage»)
1. Stage: panel `stone` con borde de 1px, radio 16 y una dot grid (radial de 1px cada 16px) con máscara que se desvanece hacia abajo.
2. Ventana de app con barra de 3 puntos, título centrado y tag `PREVIEW`, más una sombra larga y suave: `0 30px 70px -30px rgba(14,17,22,.35)`.
3. Dos cards flotantes que **pisan el borde** de la ventana: el toast «Payment blocked» abajo a la derecha y el covenant abajo a la izquierda. Esto hace las veces del teléfono y la tarjeta de Ramp.
4. Datos reales marcados con el tag azul `TESTNET` (5.00 locked y monitor con 0.50). Todo lo demás lleva el tag gris `EXAMPLE`, y hay una nota al pie con el link al pool en Stellar Expert.

## Movimiento (GSAP 3.12.5 + ScrollTrigger, CDN)
Ramp se mueve poco y con precisión: fades cortos, nada de rebotes exagerados ni efectos de cursor.

Easing global: `power3.out` (en CSS, `cubic-bezier(.2,.7,.1,1)`).

| Paso | Qué | Duración | Offset |
|---|---|---|---|
| 1 | Ventana: `y 48 → 0`, opacity 0→1 | .9s | trigger `top 80%`, `once:true` |
| 2 | KPIs: `y 14`, stagger .07 | .5s | -.45s |
| 3 | Contadores 0 → valor (`toFixed(2)`), `power2.out` | 1.1s | junto a los KPIs |
| 4 | Barras de límite: `scaleX 0→1` (`transform-origin:left`), stagger .08 | .8s | -.2s |
| 5 | Filas de agentes y pagos: `x 14`, opacity, stagger .09 | .45s | en paralelo con 4 |
| 6 | Fila «Blocked»: flash de fondo rojo al 28% → 0 | 1.1s | -.05s |
| 7 | Toast: `y 18`, `scale .96`, `back.out(1.5)` | .6s | +.1s |
| 8 | Card de covenant: `y 18` | .6s | +.15s |

Total: unos 3s. Las secciones siguientes usan un reveal genérico (`y 24`, .7s, `ScrollTrigger.batch` con stagger .08, `start:'top 85%'`).

**Solo en desktop (≥ 861px, `gsap.matchMedia`)**
- La ventana se aplana al hacer scroll: `rotateX 9→0` y `scale .965→1`, con `scrub .6` entre `top 95%` y `top 25%`. Requiere `perspective:1600px` en el stage y `transform-origin:50% 0`.
- Parallax de los flotantes: toast `y -28` y covenant `y -14`, con scrub en todo el recorrido del stage.

**Sin JS o con reduced motion**
- Los estados iniciales los pone solo JS (`gsap.from`), así que si el CDN falla todo se ve igual.
- Con `prefers-reduced-motion: reduce` no se anima nada: return temprano y CSS sin transiciones.

## Para portar a Next/React
- Mantener el layout del stage como componente (`<HeroStage/>`). Los números van como props, con una flag `isLive` por dato para decidir entre el tag `TESTNET` y `EXAMPLE`.
- GSAP dentro de `useGSAP()` (o `useLayoutEffect` + `gsap.context`) con cleanup, y `gsap.matchMedia()` para lo exclusivo de desktop.
- Ningún número nuevo sin fuente: lo real es 1 pool, 5 USDC bloqueados, 1 agente con límite 0.50, 4 contratos, 83 tests y las tx de testnet de la landing.
