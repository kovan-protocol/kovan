"""Build native, editable PowerPoint decks and a self-contained HTML presenter.

Uses the repository's brand fonts and extracted event logo. Requires python-pptx,
fontTools (with WOFF2 support), and Pillow. No application code or deployments change.
"""
from pathlib import Path
import base64
import html
import json
import math
import re
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.xmlchemy import OxmlElement
from pptx.oxml.ns import qn
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import ImageFont, Image

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
WORK = Path('/tmp/kovan-pitch-work')
FONTDIR = WORK / 'fonts'
FONTDIR.mkdir(parents=True, exist_ok=True)
BG, INK, MUTED, LINE = 'FBFBFA', '151A24', '626977', 'E3E5E9'
BLUE, SOFT, DARK, WHITE = '014CFE', 'EAF0FF', '07080B', 'FFFFFF'
GREEN, RED = '167248', 'B83240'
FONTS = {'Manrope':'manrope', 'Inter':'inter', 'JetBrains Mono':'jetbrains-mono'}
font_cache = {}
for family, stem in FONTS.items():
    for weight in (400, 600, 800):
        path = FONTDIR / f'{stem}-{weight}.ttf'
        if not path.exists():
            f = TTFont(ROOT / 'signer/src/fonts' / f'{stem}-latin.woff2')
            if 'fvar' in f:
                f = instantiateVariableFont(f, {'wght': weight}, inplace=True)
            f.flavor = None
            # Give fontconfig stable, selectable names for the PDF export.
            style = 'Bold' if weight == 800 else ('SemiBold' if weight == 600 else 'Regular')
            for record in f['name'].names:
                value = {1:family, 2:style, 4:f'{family} {style}',
                         6:f'{family.replace(" ", "")}-{style}', 16:family, 17:style}.get(record.nameID)
                if value:
                    record.string = value.encode(record.getEncoding(), errors='replace')
            f.save(path)
        font_cache[(family, weight)] = path
(WORK/'fonts.conf').write_text(f'''<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>{FONTDIR}</dir><cachedir>{WORK}/fontcache</cachedir></fontconfig>''')

def color(c): return RGBColor.from_string(c)
def esc(s): return html.escape(str(s), quote=True)
def b64(path): return base64.b64encode(Path(path).read_bytes()).decode()

def flatten(sh):
    """Suppress the template's theme effects on native shapes and connectors."""
    sh._element.spPr.append(OxmlElement('a:effectLst'))
    style=sh._element.find(qn('p:style'))
    if style is not None:
        effect=style.find(qn('a:effectRef'))
        if effect is not None: effect.set('idx','0')

def new_prs():
    p = Presentation()
    p.slide_width, p.slide_height = Inches(20), Inches(11.25)
    p.core_properties.author = 'Kovan'
    p.core_properties.subject = 'HackMeridian 2026 · Agents that spend'
    p.core_properties.title = 'Kovan — Agent autonomy. Human control.'
    return p

MAIN, BACKUP = new_prs(), new_prs()
SLIDES, WARNINGS = [], []

class Slide:
    def __init__(self, title, section, n, dark=False, backup=False):
        self.title, self.section, self.n = title, section, n
        self.dark, self.backup = dark, backup
        self.slide = (BACKUP if backup else MAIN).slides.add_slide((BACKUP if backup else MAIN).slide_layouts[6])
        self.slide.background.fill.solid()
        self.slide.background.fill.fore_color.rgb = color(DARK if dark else BG)
        self.svg = [f'<rect width="1440" height="810" fill="#{DARK if dark else BG}"/>']
        self.notes = ''
        self.texts = []
        self.ink = 'EDF0F6' if dark else INK
        self.muted = 'A0A9BA' if dark else MUTED
        self.line = '29313F' if dark else LINE
        self.logo(.8, .5, .40, '3D74FF' if dark else BLUE)
        self.txt('kovan', 1.22, .49, 2, .5, 27, 'Manrope', 800, self.ink)
        self.txt('HACKMERIDIAN 2026 / LISBON', 6.2, .63, 7.6, .3, 14, 'JetBrains Mono', 400, self.muted, align='center')
        self.txt(f'{"BACKUP" if backup else "PITCH"}  {n:02d} / {7 if backup else 5:02d}', 16.0, .63, 3.2, .3, 14, 'JetBrains Mono', 400, self.muted, align='right')
        self.rule(.8, 1.18, 19.2, 1.18, self.line)
        self.rule(.8, 10.43, 19.2, 10.43, self.line)
        self.txt('STELLAR TESTNET · HACKATHON PROTOTYPE', .8, 10.68, 10.5, .24, 12, 'JetBrains Mono', 400, self.muted)
        self.img(OUT/'assets'/f'hackmeridian-{"light" if dark else "dark"}.png',16.6,10.65,2.6,.453)
        SLIDES.append(self)

    def rect(self,x,y,w,h,fill=None,stroke=None,radius=0,lw=1):
        sh=self.slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
        if radius:
            sh.adjustments[0] = min(radius/min(w,h), .5)
        if fill: sh.fill.solid(); sh.fill.fore_color.rgb=color(fill)
        else: sh.fill.background()
        if stroke: sh.line.color.rgb=color(stroke); sh.line.width=Pt(lw)
        else: sh.line.fill.background()
        flatten(sh)
        self.svg.append(f'<rect x="{x*72}" y="{y*72}" width="{w*72}" height="{h*72}" rx="{radius*72}" fill="#{fill}" stroke="#{stroke}" stroke-width="{lw}"/>'.replace('="#None"','="none"'))
        return sh

    def rule(self,x,y,x2,y2,c=LINE,lw=1):
        sh=self.slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x), Inches(y), Inches(x2), Inches(y2))
        sh.line.color.rgb=color(c);sh.line.width=Pt(lw)
        flatten(sh)
        self.svg.append(f'<line x1="{x*72}" y1="{y*72}" x2="{x2*72}" y2="{y2*72}" stroke="#{c}" stroke-width="{lw}"/>')

    def poly(self,pts,c):
        b=self.slide.shapes.build_freeform(Inches(pts[0][0]),Inches(pts[0][1]))
        b.add_line_segments([(Inches(x),Inches(y)) for x,y in pts[1:]],close=True)
        sh=b.convert_to_shape();sh.fill.solid();sh.fill.fore_color.rgb=color(c);sh.line.fill.background()
        flatten(sh)
        self.svg.append('<polygon points="'+' '.join(f'{x*72},{y*72}' for x,y in pts)+f'" fill="#{c}"/>')

    def arrow(self,x,y,x2,y2,c=BLUE):
        self.rule(x,y,x2,y2,c,1.5)
        a=math.atan2(y2-y,x2-x);d=.11
        self.poly([(x2,y2),(x2-d*math.cos(a)+d*.6*math.sin(a),y2-d*math.sin(a)-d*.6*math.cos(a)),(x2-d*math.cos(a)-d*.6*math.sin(a),y2-d*math.sin(a)+d*.6*math.cos(a))],c)

    def logo(self,x,y,h,c=BLUE):
        sc=h/505
        for pts in [[(0,183),(401,0),(401,153),(0,336)],[(62,350),(330,229),(330,505)]]:
            self.poly([(x+a*sc,y+b*sc) for a,b in pts],c)

    def txt(self,text,x,y,w,h,size=30,font='Inter',weight=400,c=None,align='left',leading=1.18,url=None):
        c=c or self.ink
        sh=self.slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h))
        tf=sh.text_frame; tf.clear(); tf.word_wrap=False
        tf.margin_left=tf.margin_right=tf.margin_top=tf.margin_bottom=0
        tf.vertical_anchor=MSO_ANCHOR.TOP
        lines=text.split('\n')
        pf=ImageFont.truetype(str(font_cache[(font,weight)]),size=round(size*4))
        for i,line in enumerate(lines):
            measured=pf.getlength(line)/4
            if measured > w*72+2:
                WARNINGS.append(f'{self.section}: text over width ({measured:.0f}>{w*72:.0f}): {line}')
            p=tf.paragraphs[0] if i==0 else tf.add_paragraph()
            p.space_before=p.space_after=Pt(0);p.line_spacing=Pt(size*leading)
            p.alignment={'left':PP_ALIGN.LEFT,'center':PP_ALIGN.CENTER,'right':PP_ALIGN.RIGHT}[align]
            r=p.add_run();r.text=line;r.font.name=font;r.font.size=Pt(size);r.font.bold=(weight>=600);r.font.color.rgb=color(c)
            sx=(x + (w/2 if align=='center' else (w if align=='right' else 0)))*72
            self.svg.append(f'<text x="{sx}" y="{y*72+size*.93+i*size*leading}" fill="#{c}" font-family="{font}" font-weight="{weight}" font-size="{size}" text-anchor="{{}}">{esc(line)}</text>'.format({'left':'start','center':'middle','right':'end'}[align]))
        if len(lines)*size*leading > h*72+size*.25:
            WARNINGS.append(f'{self.section}: text over height: {text}')
        self.texts.append(text)
        if url:
            # Shape-level links preserve the chosen color in PowerPoint/LibreOffice.
            sh.click_action.hyperlink.address=url
        return sh

    def img(self,path,x,y,w,h):
        self.slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))
        self.svg.append(f'<image x="{x*72}" y="{y*72}" width="{w*72}" height="{h*72}" href="data:image/png;base64,{b64(path)}"/>')

    def label(self,text,x=.8,y=1.55,w=18):
        self.txt(text,x,y,w,.3,14,'JetBrains Mono',600,'87AAFF' if self.dark else BLUE)

    def heading(self,text,y=2.07,w=18.4,size=52):
        self.txt(text,.8,y,w,1.65,size,'Manrope',800,leading=1.08)

    def note(self,text):
        self.notes=text.strip()
        self.slide.notes_slide.notes_text_frame.text=self.notes

    def source(self,text,url=None):
        self.txt(text,.8,10.02,18.4,.24,11,'Inter',400,self.muted,url=url)

    def svg_doc(self):return '<svg viewBox="0 0 1440 810" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+esc(self.title)+'">'+''.join(self.svg)+'</svg>'


# 1. Cover — the official template's first section.
s=Slide('Give agents a budget, not your wallet.','Cover',1,dark=True)
s.label('GENESIS + STELLAR COMPOSED / AGENTS THAT SPEND')
s.txt('Give agents\na budget.',.8,2.25,10.7,2.5,80,'Manrope',800,'EDF0F6',leading=1.02)
s.txt('Keep the control.',.8,5.02,11,1.0,52,'Manrope',800,'87AAFF')
s.txt('Shared USDC budgets, enforced\nby Stellar smart accounts.',.85,6.45,10.7,1.35,32,'Inter',400,'A0A9BA',leading=1.28)
s.txt('Agent autonomy. Human control.',.85,8.7,11.8,.6,28,'Inter',600,'EDF0F6')
s.rect(12.7,2.27,6.5,6.97,'0F1217','29313F',.12)
s.label('ONE POOL / MANY AGENTS',13.15,2.75,5.5)
s.txt('100',13.1,3.32,5.7,1.25,86,'Manrope',800,'EDF0F6')
s.txt('USDC · shared budget',13.15,4.72,5.6,.45,23,'Inter',400,'A0A9BA')
for y,name,amt,bw in [(5.65,'Research agent','40',2.2),(6.65,'Monitoring agent','30',1.65),(7.65,'Unallocated','30',1.65)]:
    s.txt(name,13.15,y,4.8,.38,20,'Inter',400,'EDF0F6')
    s.txt(amt,17.5,y,1.2,.38,20,'JetBrains Mono',600,'EDF0F6',align='right')
    s.rect(13.15,y+.55,5.55,.075,'29313F');s.rect(13.15,y+.55,bw,.075,'3D74FF' if y<7 else '626977')
s.txt('ILLUSTRATIVE ALLOCATION',13.15,8.76,5.5,.23,12,'JetBrains Mono',400,'A0A9BA')
s.note('''0:00–0:12 · COVER
AI agents are starting to spend money on their own. Kovan gives them a shared USDC budget, with spending rules enforced by their own Stellar smart accounts. Agent autonomy. Human control.

The 100 USDC allocation is an illustrative example, not traction or current pool funding. All product evidence in this presentation is testnet evidence; testnet tokens have no real value. The project is unaudited.
Transition: Here is how we separate an agent's ability to work from its ability to move money.''')

# 2. Solution.
s=Slide('One shared pool. Every agent has limits.','The solution',2)
s.label('01 / THE SOLUTION')
s.heading('One shared pool.\nEvery agent has limits.')
s.txt('An on-chain covenant defines the spending boundary.',.85,3.88,18,.65,30,c=MUTED)
# Pool / agents diagram.
s.rect(.85,5.07,4.0,1.5,BLUE,radius=.10)
s.txt('USDC pool',1.18,5.33,3.35,.6,32,'Manrope',800,WHITE)
s.txt('Owner funds once',1.18,6.02,3.35,.35,20,'Inter',400,WHITE)
s.arrow(4.85,5.82,5.35,5.82)
s.rule(5.35,5.32,5.35,7.50,BLUE,1.5)
for y,name in [(4.83,'Agent A'),(6.85,'Agent B')]:
    s.arrow(5.35,y+.6,5.82,y+.6)
    s.rect(5.84,y,4.25,1.43,WHITE,LINE,.10)
    s.txt(name,6.15,y+.22,3.5,.54,30,'Manrope',800)
    s.txt('Own smart account',6.15,y+.88,3.6,.35,19,c=MUTED)
s.txt('Delegate smaller budgets.\nRevoke and recover unused funds.',.85,8.72,10.2,1.02,26,'Inter',600,INK)
s.rect(11.05,4.87,8.15,4.95,WHITE,LINE,.12)
s.label('EACH AGENT’S COVENANT',11.48,5.27,7.2)
for yy,key,val in [(6.04,'Who','Approved payees'),(6.85,'How much','Payment + total caps'),(7.66,'Until when','Expiry + revocation')]:
    s.txt(key,11.48,yy,2.6,.48,24,'Inter',400,MUTED)
    s.txt(val,14.08,yy,4.78,.48,24,'Inter',600,INK)
    s.rule(11.48,yy+.64,18.75,yy+.64,LINE)
s.txt('Agent cannot remove its policy.',11.48,8.75,7.2,.55,25,'Inter',600,BLUE)
s.note('''0:12–0:42 · SOLUTION
You lock USDC in one pool. Each agent gets its own smart account and a covenant: who it may pay, how much per payment and in total, and until when. The pool keeps allocations backed. An agent can delegate a narrower budget to a child, carved out of its own allocation. The owner can revoke and recover unused funds without needing the agent's key. The agent cannot remove the spending policy.

Technical detail: the signer, allowlists and policy binding are fixed at account creation. The owner can amend numeric limits and expiry. The recovery allowance is established at creation and lasts 3,000,000 ledgers. Children must be closed before their parent. Recovery does not undo completed payments.
Do not claim the system prevents all prompt injection: a compromised agent may still waste its approved budget with an approved payee. Contract bugs and deployment configuration are separate risks.
Sources: README.md; contracts/agent-account; contracts/covenant-policy; contracts/pool.''')

# 3. PMF, grounded in the actual user and a testable adoption thesis.
s=Slide('Agents can pay. Teams need control.','PMF',3)
s.label('02 / PMF')
s.heading('Agents can pay.\nTeams need control.')
s.txt('First users: developers whose agents buy data, APIs and compute.',.85,3.92,18.2,.65,30,c=MUTED)
s.label('THE WORKFLOW TODAY',.85,5.05,8.2)
for y,num,title,detail in [(5.65,'01','Fund a wallet','Expose the balance to mistakes.'),(7.08,'02','Approve every refill','Put a human back in the loop.')]:
    s.txt(num,.85,y+.05,.7,.5,20,'JetBrains Mono',600,MUTED)
    s.txt(title,1.7,y,7.6,.62,32,'Manrope',800)
    s.txt(detail,1.7,y+.72,8.1,.6,25,c=MUTED)
s.rect(10.6,5.0,8.6,3.75,SOFT,radius=.12)
s.label('KOVAN’S STARTING POINT',11.05,5.4,7.7)
s.txt('Authorize a budget.\nLet the agent execute.',11.05,6.0,7.7,1.6,36,'Manrope',800,INK,leading=1.2)
s.txt('One pool · scoped wallets · recovery',11.05,7.95,7.75,.5,23,'Inter',600,BLUE)
s.rule(.85,9.15,19.2,9.15,LINE)
s.txt('WHY NOW',.85,9.42,2.5,.35,14,'JetBrains Mono',600,BLUE)
s.txt('x402 brings per-request payments to Stellar APIs.',3.1,9.36,16,.55,26,c=INK)
s.source('Initial customer hypothesis; product-market fit and revenue are not yet demonstrated. x402: Stellar Developer Docs.', 'https://developers.stellar.org/docs/build/agentic-payments/x402/')
s.note('''0:42–1:08 · PMF / PROBLEM
Our first user is a developer running agents that buy data, APIs or compute. Today they either fund a wallet and expose that balance, or interrupt the agent with manual top-ups. x402 makes paying per request possible. Kovan adds a shared treasury and an enforceable spending boundary around those payments. The first pilot question is simple: can a team let an agent complete useful paid work and keep every payment within its approved rules?

Objection prep — “Have you proven product-market fit?”
No. The evidence today proves execution and controls on testnet, not customer demand. Recruit developers already using paid APIs and measure completed tasks, paid calls, rejected out-of-policy attempts, and repeat weekly use.

The original deck's unsubstantiated “9+ teams” line and broad incident comparisons are omitted. A jailbreak challenge and a real operational compromise are not interchangeable evidence of customer demand.
Current ecosystem context checked 2026-10-26: Stellar Developer Docs describes x402 per-request payments, Soroban auth-entry signing, SEP-41 assets and USDC as the default asset. https://developers.stellar.org/docs/build/agentic-payments/x402/''')

# 4. Technical workflow plus the 65-second demo.
s=Slide('Pay. Refuse. Recover.','Technical workflow',4)
s.label('03 / TECHNICAL WORKFLOW')
s.heading('Pay. Refuse. Recover.',w=18.4,size=58)
s.txt('Humans configure. Smart accounts enforce. Agents execute.',.85,3.24,18.2,.7,30,c=MUTED)
nodes=[(.85,'Owner','Signs in Freighter'),(5.6,'Pool','Backs agent limits'),(10.35,'Agent account','Covenant + verifier'),(15.1,'Provider','Direct or x402')]
for x,title,detail in nodes:
    s.rect(x,4.40,4.1,1.6,BLUE if title=='Agent account' else WHITE,None if title=='Agent account' else LINE,.10)
    s.txt(title,x+.25,4.69,3.6,.62,28,'Manrope',800,WHITE if title=='Agent account' else INK)
    s.txt(detail,x+.25,5.39,3.6,.4,20,'Inter',400,WHITE if title=='Agent account' else MUTED)
    if x<15:s.arrow(x+4.13,5.2,x+4.6,5.2)
s.label('DEMO / 65 SECONDS',.85,6.62,8)
for x,num,title,detail,c in [(.85,'01','Pay an API','0.01 testnet USDC',GREEN),(7.1,'02','Refuse a payee','PayeeNotAllowed',RED),(13.35,'03','Revoke + recover','Return unused funds',BLUE)]:
    s.txt(num,x,7.23,1,.6,21,'JetBrains Mono',600,c)
    s.txt(title,x,7.95,5.85,.64,30,'Manrope',800)
    s.txt(detail,x,8.68,5.85,.45,23,'Inter',400,MUTED)
s.source('Proof: historical USDC x402 transaction + separate v2 lifecycle with testnet XLM. Refusal was simulated before submission.', 'https://github.com/kovan-protocol/kovan')
s.note('''1:08–1:35 · WORKFLOW
Four Soroban contracts power this: the pool, agent account, covenant policy and signature verifier. The owner funds the pool and approves setup in Freighter. The pool deploys an account for each agent. Every outgoing authorized call is checked by the covenant. We built the smart-account authorization payload needed to pay over x402. The same covenant applies to direct transfers.

1:35–2:40 · DEMO — show the application or prepared recording
00–15 seconds: show a funded pool and one prepared agent. Point to its approved payee and spending cap. “The owner approves setup in their own wallet; the agent uses its own key.”
15–35 seconds: execute or replay the x402 payment. “The API returns 402. The agent signs an authorization, the facilitator settles the payment, and the API returns the content.” Show the actual transaction receipt.
35–50 seconds: attempt payment to an unapproved address. “The account refuses it: PayeeNotAllowed. This is a contract authorization failure before submission, so there is no failed transaction hash to show.”
50–65 seconds: show revocation and recovery, or the documented v2 lifecycle receipt. “New spending stops. We close the agent and recover unused funds without the agent's key.”

Evidence boundaries: historical USDC x402 transaction 781a5f2b560df66d3d6c587ef4f2a283e82421ce16b54565a9a64a8ba662775d belongs to a legacy pool. Full v2 revoke/recover/shutdown evidence is a separate isolated testnet XLM pool in docs/SDK.md. Do not present these as one continuous USDC run. Rehearse a fresh sequence before recording. No new payment was submitted while making this deck.
Owner-approved mandates are live on the current release (rehearsed with a direct payment on an isolated pool; not yet through the x402 facilitator). Delegation has no on-chain evidence yet and DeFindex yield is not activated: keep both out of the live demo unless rehearsed.

Why Stellar: the settlement asset, programmable authorization and HTTP payment rail are composable. Official sources: https://developers.stellar.org/docs/build/agentic-payments/x402/ ; https://docs.openzeppelin.com/stellar-contracts/accounts/policies ; https://www.circle.com/multi-chain-usdc/stellar .''')

# 5. Team.
s=Slide('Built at HackMeridian.','The team',5)
s.label('04 / THE TEAM')
s.heading('Built at HackMeridian.')
s.txt('Agent autonomy. Human control.',.85,3.28,18,.7,34,'Inter',400,MUTED)
s.label('TEAM',.85,4.73,9.7)
TEAM=[('Robert Lopez','DevOps Engineer'),('Esteban Brenes','Product Manager'),('Sebastián Ceciliano','AI Developer / Designer')]
for (name,role),y in zip(TEAM,[5.37,6.6,7.83]):
    s.txt(name,.85,y,5.2,.6,30,'Manrope',600)
    s.txt(role,6.05,y+.06,3.55,.55,21,'Inter',400,MUTED)
    s.rule(.85,y+.83,9.55,y+.83,LINE)
s.txt('Contracts · SDK · agent tooling · interface',.85,9.25,9.3,.43,21,'Inter',400,MUTED)
s.rect(10.7,4.70,8.5,5.0,BLUE,radius=.12)
s.logo(17.6,5.08,.65,WHITE)
s.txt('Try the bounded\nspending loop.',11.17,5.48,7.5,1.6,42,'Manrope',800,WHITE,leading=1.13)
s.txt('kovan-protocol.vercel.app',11.17,7.67,7.48,.58,27,'Inter',600,WHITE,url='https://kovan-protocol.vercel.app')
s.txt('github.com/kovan-protocol/kovan',11.17,8.47,7.48,.50,21,'Inter',400,WHITE,url='https://github.com/kovan-protocol/kovan')
s.note('''2:40–3:00 · TEAM / CLOSE
Robert Lopez, DevOps Engineer: contracts, SDK, console, agent tooling and deployments. Esteban Brenes, Product Manager: product, pitch, docs and submission. Sebastián Ceciliano, AI Developer / Designer: website, brand and the signing-page design.
We built Kovan at HackMeridian: shared budgets, on-chain spending rules and a working smart-account x402 payment. We want developers of paid-API agents to try the bounded spending loop and tell us where it breaks. Kovan. Give your agents a budget, not your wallet.

Do not claim a precise 24-hour build duration without confirming it.
Evidence for build period: README.md “Built during event vs prior work” and docs/SUBMISSION_FORM.md, which disclose event-built code, prior planning, OpenZeppelin verifier code and vendored Stellar skills.
The website's primary demo may be the interactive playground (a simulation); it is not the deployed owner dashboard. Use an actual running console for live payments.
Suggested pilot invitation, not an existing customer claim. No funding amount or commercial commitment has been invented.''')

# BACKUP A — actual product UI, explicitly fixture-backed.
s=Slide('The owner’s control surface.','Product demo',1,backup=True)
s.label('A / PRODUCT DEMO')
s.heading('The owner’s control surface.',size=48)
s.img(OUT/'assets/dashboard-fixture.png',.85,3.46,9.30,6.46)
s.rect(11.47,3.46,7.73,5.95,SOFT,radius=.1)
s.label('REHEARSAL CHECKLIST',11.9,3.9,6.8)
for yy,t,d in [(4.65,'1. Inspect the rules','Show payee, cap and expiry.'),(6.0,'2. Show the receipt','Open the explorer transaction.'),(7.35,'3. Trigger a refusal','Explain why no funds move.')]:
    s.txt(t,11.9,yy,6.85,.6,29,'Manrope',800)
    s.txt(d,11.9,yy+.67,6.85,.55,24,c=MUTED)
s.source('Actual dashboard UI from a browser check; balances and agent state are illustrative test fixtures, not live funds.')
s.note('''BACKUP A · PRODUCT DEMO
This is the real dashboard UI captured in a browser check with API fixtures. The values are not chain activity or evidence of users. It is included to show the product surface, not to substitute for a transaction receipt.
The screenshot was already present in /tmp/kovan-design-review-qQWT0a/dashboard-light-1440.png; the associated script intercepts /api/state and /api/events. For the stage demo, use the running dashboard and real testnet records, or an explicitly labeled replay.
Prepare: funded testnet pool, approved payee, small cap, endpoint terms, explorer tabs, and backup recording. Use a fresh agent for repeat demos so spent caps and revocations do not invalidate the script.''')

# BACKUP B — meaningful technical differentiation.
s=Slide('A policy the agent cannot remove.','Authorization',2,backup=True)
s.label('B / AUTHORIZATION BOUNDARY')
s.heading('A policy the agent cannot remove.',size=48)
for x,n,t,d in [(0.85,'01','Agent signs','Its own Ed25519 key.'),(7.1,'02','Account verifies','Signature + covenant.'),(13.35,'03','Call executes','Only inside the rules.')]:
    s.txt(n,x,3.85,1,.5,22,'JetBrains Mono',600,BLUE)
    s.txt(t,x,4.60,5.8,.7,34,'Manrope',800)
    s.txt(d,x,5.4,5.8,.6,26,c=MUTED)
    if x<13:s.arrow(x+5.55,4.9,x+6.0,4.9)
s.rule(.85,6.6,19.2,6.6,LINE)
s.label('FIXED AT CREATION',.85,7.1,8.5)
s.txt('Signer, allowlists, policy binding.\nNo management rule to remove them.',.85,7.75,9.0,1.5,28,'Inter',400,INK)
s.label('OWNER CONTROLS',10.6,7.1,8.6)
s.txt('Numeric limits, expiry, revocation.\nRecovery without the agent’s key.',10.6,7.75,8.6,1.5,28,'Inter',400,INK)
s.source('Source: README.md and agent-account/covenant-policy implementation. Recovery remains subject to the token allowance.')
s.note('''BACKUP B · HOW THE BOUNDARY WORKS
The pool deploys an OpenZeppelin smart account with one context rule: the agent's External Ed25519 signer and the covenant policy. It has no management rule. The account cannot add a signer or remove the policy through an authorized self-call.
The policy is a separate contract from the pool to avoid Soroban re-entry constraints. It checks approved token transfers and configured contract calls, caps, expiry and revocation. The verifier checks the agent's signature.
Differentiation: Kovan combines shared allocation accounting, frozen agent accounts, narrower delegation and owner recovery. x402 is the payment transport; OpenZeppelin is the account primitive. They are foundations, not competitors Kovan replaces.
For a stolen key: the attacker still operates within the permitted destinations and caps, but may exhaust those budgets. Revoke quickly. Recovery can only recover the remaining balance and depends on the allowance, contract execution and available chain state.
Official reference: https://docs.openzeppelin.com/stellar-contracts/accounts/policies''')

# BACKUP C — accounting clarity, not misleading balance claims.
s=Slide('Spent funds never become a new budget.','Pool accounting',3,backup=True)
s.label('C / POOL ACCOUNTING')
s.heading('Spent funds never become a new budget.',size=46)
s.txt('Example: one agent draws 10 USDC and spends 3.',.85,3.35,18.2,.7,32,c=MUTED)
for x,amount,label,desc in [(.85,'10','DRAWN','Advanced to the agent'),(7.1,'3','SPENT','Settled as consumed'),(13.35,'7','RECOVERED','Returned on closure')]:
    s.txt(amount,x,4.7,5.6,1.8,104,'Manrope',800,BLUE)
    s.label(label,x,6.55,5.7)
    s.txt(desc,x,7.16,5.7,.65,25,c=MUTED)
s.rect(.85,8.50,18.35,1.03,SOFT,radius=.10)
s.txt('Only the unused 7 is released for another allocation.',1.24,8.78,17.55,.6,30,'Inter',600,INK)
s.source('Illustrative arithmetic from README.md, “Deployed cash-pool accounting v2”; amounts are not usage metrics.')
s.note('''BACKUP C · ACCOUNTING
For v2, locked is an accounting total: actual pool cash plus outstanding agent advances. It is not simply the pool's cash balance. sum_limits is the draw limit total for non-closed agents, and available funds are locked minus sum_limits.
Closing an agent freezes spending, pulls back its balance, records unrecovered advances as settled_spent and releases unused allocation. Spent funding cannot be counted twice. A child returns only unused allocation to its parent, and children close first.
The example assumes a 10-USDC allocation drawn in full, 3 spent and 7 left in the wallet. A raw transfer to the pool is an unattributed deposit; use return_funds for the agent's reconciliation history.
Permanent pool closure requires zero open agents, allocations and advances, and returns remaining pool cash to the original owner. Historical records remain. Source: README.md.''')

# BACKUP D — live / local / next statuses clearly separated.
s=Slide('What ships today. What comes next.','Delivery status',4,backup=True)
s.label('D / DELIVERY STATUS — 26 OCT 2026')
s.heading('What ships today. What comes next.',size=48)
rows=[('TESTNET','Shared pool + covenants','Cash-only v2; x402 payment evidence.',GREEN),
      ('TESTNET','Native payment mandates','Exact or budget grants; on-chain receipts. Released 26 Oct.',GREEN),
      ('LOCAL BUILD','DeFindex yield backing','Cash-first draws; shares held by pool.',BLUE),
      ('NEXT','Distribution + pilots','SDK on npm; x402 rehearsal on the new release; pilots.',MUTED)]
for i,(tag,title,detail,c) in enumerate(rows):
    yy=3.8+i*1.43
    s.txt(tag,.85,yy+.11,3.05,.4,17,'JetBrains Mono',600,c)
    s.txt(title,4.05,yy,14.9,.6,31,'Manrope',800)
    s.txt(detail,4.05,yy+.7,14.9,.6,26,c=MUTED)
    if i<3:s.rule(.85,yy+1.25,19.2,yy+1.25,LINE)
s.source('Sources: README.md; docs/MANDATES.md; docs/YIELD.md; docs/SDK.md. Local work does not upgrade immutable deployments.')
s.note('''BACKUP D · COMPLETENESS WITHOUT OVERCLAIMING
Current default deployment: cash-only pool v2. Historical USDC x402 evidence and isolated v2 lifecycle evidence are linked in the evidence slide.
Native Kovan mandates: released on testnet on 2026-10-26 (policy CAQAHBSHKEUQCXUMFCD65GNRTKDNE5A7HOHA7XVOKVKTV4H4O63OWJYB; new pools use the release) and rehearsed end to end on an isolated pool with a direct payment. Facilitator acceptance of the mandate envelope over x402 is not yet rehearsed. They add owner-approved exact/budget grants, payment IDs, expiry and receipts, and intersect with covenant limits. They are not AP2 signed credentials, MCP, A2A, escrow or delivery verification. New compatible contracts and agents plus a funded facilitator rehearsal are required.
Yield v3: locally tested, not deployed/activated. Supports one compatible single-asset DeFindex vault and transferable shares using the exact pool asset. Cash is used before redemption. Backing discounts estimated vault value by 10%; this buffer is not insurance. Losses or unavailable liquidity may stop draws. No APY or live yield claim.
SDK: @kovan-protocol/sdk@0.1.0 is published on npm. Agent guides/plugin and owner signing flows exist.
General contract-call allowlisting is not equivalent to a completed Blend/Soroswap integration. No broad claims about MPP/AP2/A2A or reputation implementations.
This is a status snapshot from the repository, not a deployment verification run.''')

# BACKUP E — verified, scoped evidence.
s=Slide('Inspect the evidence.','Evidence',5,backup=True)
s.label('E / EVIDENCE, WITH SCOPE')
s.heading('Inspect the evidence.',size=54)
s.rect(.85,3.45,5.6,5.95,BLUE,radius=.10)
s.txt('547',1.25,4.0,4.8,1.65,100,'Manrope',800,WHITE)
s.txt('tests passing on main',1.27,5.9,4.7,.6,25,'Inter',600,WHITE)
s.txt('152 contracts\n267 dashboard\n79 SDK · 49 signer',1.27,6.85,4.7,1.7,26,'Inter',400,WHITE,leading=1.5)
evidence=[('USDC / LEGACY POOL','0.01 USDC paid over x402','781a5f2b… · API content returned','https://stellar.expert/explorer/testnet/tx/781a5f2b560df66d3d6c587ef4f2a283e82421ce16b54565a9a64a8ba662775d'),
          ('XLM / ISOLATED V2 POOL','Complete cash lifecycle','Pay, revoke, recover, close; testnet XLM','https://github.com/kovan-protocol/kovan/blob/main/docs/SDK.md'),
          ('PRE-SUBMISSION SIMULATION','Unapproved payee refused','PayeeNotAllowed · no submitted transaction','https://github.com/kovan-protocol/kovan#testnet-transaction-evidence')]
for i,(tag,title,detail,url) in enumerate(evidence):
    yy=3.65+i*1.98
    s.label(tag,7.1,yy,12.1)
    s.txt(title,7.1,yy+.54,12.1,.65,31,'Manrope',800,url=url)
    s.txt(detail,7.1,yy+1.23,12.1,.5,24,c=MUTED)
    if i<2:s.rule(7.1,yy+1.76,19.2,yy+1.76,LINE)
s.source('547 = test run on main, 2026-10-26: 152 Rust, 267 dashboard, 79 SDK, 49 signer; excludes one optional ignored fixture test and six opt-in network tests.')
s.note('''BACKUP E · EVIDENCE REGISTER
Test count is 152 Rust + 267 dashboard + 79 SDK + 49 signer = 547, run on main on 2026-10-26 (README, Testing). It includes the released mandates and the unactivated yield work, and excludes an optional ignored external fixture test. It does not establish an audit or a live production deployment.
Legacy USDC x402 payment: https://stellar.expert/explorer/testnet/tx/781a5f2b560df66d3d6c587ef4f2a283e82421ce16b54565a9a64a8ba662775d
Legacy USDC direct payment: https://stellar.expert/explorer/testnet/tx/263d05036ee5bcc7520cef1dc39fb36a85ab4c90d5eda2caa5a62e7d2b0f4fb0
Legacy USDC return: https://stellar.expert/explorer/testnet/tx/c455d6a3229fe29f82ecd00d26de2d0c86ee76f365a8230bb96b153db71665b3
Current default v2 deployment: https://stellar.expert/explorer/testnet/tx/b2b2f1f8fd3911504f91a5d9f959ffdb61a24e1b9a9fa9c29b56965eb26074f5
Separate isolated v2 XLM agent closure: https://stellar.expert/explorer/testnet/tx/4d1eb6b875096c799aefc9bbb6e7a50ce201e85a8330517c9fc4ea02a66969f4
Separate isolated v2 XLM pool shutdown: https://stellar.expert/explorer/testnet/tx/0a8d81a9006b5a53ec6676e0df72a99d0ce6a30812b65f075631db097accc0ae
Sources: README.md, docs/SDK.md, docs/MANDATES.md. Contract records were not independently re-queried in this deck task. Testnet history can reset.''')

# BACKUP F — adoption flow, accurate SDK identity.
s=Slide('Built to be adopted by agents.','Integration',6,backup=True)
s.label('F / ADOPTION')
s.heading('Built to be adopted by agents.',size=50)
for y,num,title,detail in [(3.9,'01','Give the agent the guide','agent.md · llms.txt · Claude Code plugin'),(5.65,'02','Approve with your own wallet','Agent prepares. Owner reviews and signs.'),(7.4,'03','Integrate the TypeScript SDK','Pools, payments, signing and recovery.')]:
    s.txt(num,.85,y+.05,1,.5,22,'JetBrains Mono',600,BLUE)
    s.txt(title,2.0,y,17,.65,35,'Manrope',800)
    s.txt(detail,2.0,y+.8,17,.65,28,c=MUTED)
    if y<7:s.rule(2.0,y+1.45,19.2,y+1.45,LINE)
s.source('@kovan-protocol/sdk@0.1.0 is on npm. Guide: kovan-protocol.vercel.app/agent.md', 'https://kovan-protocol.vercel.app/agent.md')
s.note('''BACKUP F · INTEGRATION / PATH TO USERS
The agent guide and Claude Code plugin let an agent prepare owner transactions using kovan.mjs. Owner approvals are signed in Freighter through local or hosted signing interfaces. Runtime agents may supply their own public keys; app-managed keys are an optional convenience and the app retains its signing copy even after export.
The package name is @kovan-protocol/sdk, not @kovan/sdk. It is a local TypeScript/ESM package; do not show npm install as a published workflow until a package is actually released. Applications supply their own configuration and signers.
Go-to-market hypothesis: start with developers already running x402 API agents, publish reproducible examples, onboard pilot teams and measure useful paid tasks and repeat usage. No revenue, customer count or committed commercial model is asserted. A possible future business is hosted operations and monitoring; validate willingness to pay before putting pricing on a slide.''')

# BACKUP G — useful judge questions, readable slide.
s=Slide('What the covenant does—and doesn’t do.','Judge Q&A',7,backup=True)
s.label('G / JUDGE Q&A')
s.heading('A spending boundary, not a guarantee.',size=49)
for yy,q,a in [(3.8,'Can prompt injection still do harm?','Yes—within an approved budget and payee list.'),
              (5.3,'Does a receipt prove the task succeeded?','It proves payment, not delivery or correctness.'),
              (6.8,'Can the owner get spent funds back?','Recovery returns the remaining wallet balance.'),
              (8.3,'Is it ready for real customer funds?','Testnet prototype; review and audit come first.')]:
    s.txt(q,.85,yy,18.35,.65,31,'Manrope',800)
    s.txt(a,.85,yy+.71,18.35,.6,28,c=MUTED)
s.note('''BACKUP G · TWO-SENTENCE ANSWERS
“Why not just x402?” x402 carries the payment request and settlement authorization. Kovan constrains who may be paid and how much, and coordinates many agents against one shared pool.
“Why not a standard wallet?” A raw signing key can authorize transfers from a classic account without Kovan's application policy. Kovan puts the restrictions in the smart account's authorization path, together with pool allocation accounting and recovery.
“What if the key is stolen?” The attacker remains subject to the approved payees, caps, expiry and revocation. The owner can revoke and recover the remaining funds, but a permitted payment can still be wasteful.
“Who holds keys?” Owners sign with their own wallet; runtime agents can supply their own signing keys. App-managed mode retains an application-side signing copy, so avoid a blanket claim that Kovan never holds any agent key.
“Why blockchain?” The recipient, asset and amount can be checked at the same execution boundary that moves the funds. The public settlement record makes those controls inspectable independently of the agent prompt and UI.
“Can you guarantee recovery?” Recovery does not reverse settled payments and depends on the token allowance and executable chain state. The default recovery allowance is valid for 3,000,000 ledgers from account creation.
“What about yield?” Yield is an opt-in, locally tested DeFindex integration, currently inactive. Vault losses and liquidity constraints can prevent draws; the 10% backing discount is not insurance.
“What would prove demand?” Onboard developers who already pay for agent inputs and track completed paid tasks and repeat use. The pitch currently demonstrates technical capability, not proven product-market fit.''')

MAIN.save(OUT/'kovan-pitch-deck.pptx')
BACKUP.save(OUT/'kovan-judge-backup.pptx')

# HTML uses the same diagram geometry and native text, with embedded brand fonts.
font_css='\n'.join(f'@font-face{{font-family:"{family}";src:url(data:font/woff2;base64,{b64(ROOT/"signer/src/fonts"/f"{stem}-latin.woff2")}) format("woff2");font-weight:100 900;}}' for family,stem in FONTS.items())
html_slides=''.join(f'<section class="slide" data-backup="{str(s.backup).lower()}" aria-label="{esc(s.title)}">{s.svg_doc()}</section>' for s in SLIDES)
notes=json.dumps([s.notes for s in SLIDES]).replace('</','<\\/')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kovan — HackMeridian pitch</title>
<style>FONT_CSS
*{box-sizing:border-box}body{margin:0;background:#141820;color:#edf0f6;font-family:Inter,sans-serif}.stage{height:calc(100vh - 58px);display:grid;place-items:center;padding:12px}.slide{display:none;width:min(calc((100vh - 82px)*16/9),100%);aspect-ratio:16/9}.slide.active{display:block}.slide svg{display:block;width:100%;height:100%}nav{height:58px;display:flex;align-items:center;gap:12px;padding:8px 20px;background:#0f1217;font-size:13px}button,a.control{border:1px solid #394455;background:#191f2a;border-radius:6px;color:#edf0f6;padding:10px 15px;text-decoration:none;cursor:pointer;font:inherit;min-height:40px}button:focus-visible,a:focus-visible{outline:2px solid #87aaff;outline-offset:2px}#counter{margin-right:auto;font-family:'JetBrains Mono',monospace}#notes{display:none;position:fixed;right:18px;top:18px;max-width:640px;max-height:75vh;overflow:auto;padding:24px;background:#fff;color:#151a24;border:1px solid #e3e5e9;border-radius:8px;white-space:pre-wrap;font-size:16px;line-height:1.6;box-shadow:0 10px 40px #0004}body.show-notes #notes{display:block}body.show-notes .stage{opacity:.32}@media(max-width:700px){nav{gap:5px;padding:6px;font-size:11px}button{padding:7px}.stage{padding:2px}}@media print{body{background:white}nav,#notes{display:none!important}.stage{display:block;height:auto;padding:0}.slide{display:block!important;width:100%;break-after:page}.slide:last-child{break-after:auto}@page{size:20in 11.25in;margin:0}}</style>
<main class="stage">HTML_SLIDES</main><aside id="notes" aria-label="Presenter notes"></aside><nav><span id="counter" aria-live="polite"></span><button id="prev" aria-label="Previous slide">←</button><button id="next" aria-label="Next slide">→</button><button id="toggle" aria-pressed="false">Notes · N</button><button id="backup">Judge backup · B</button><button id="full">Fullscreen</button></nav>
<script>const notes=NOTES;const slides=[...document.querySelectorAll('.slide')];let index=0;function show(n){index=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,i)=>s.classList.toggle('active',i===index));document.querySelector('#counter').textContent=index<5?`Pitch ${index+1} / 5`:`Backup ${index-4} / 7`;document.querySelector('#notes').textContent=notes[index];location.hash=index+1;}function toggleNotes(){const on=document.body.classList.toggle('show-notes');document.querySelector('#toggle').setAttribute('aria-pressed',String(on));}document.querySelector('#prev').onclick=()=>show(index-1);document.querySelector('#next').onclick=()=>show(index+1);document.querySelector('#toggle').onclick=toggleNotes;document.querySelector('#backup').onclick=()=>show(index<5?5:0);document.querySelector('#full').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();document.addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();show(index+1);}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(index-1);}if(e.key.toLowerCase()==='n')toggleNotes();if(e.key.toLowerCase()==='b')show(index<5?5:0);if(e.key==='Home')show(0);if(e.key==='End')show(slides.length-1);});show(Math.max(0,Number(location.hash.slice(1)||1)-1));</script></html>'''
page=page.replace('FONT_CSS',font_css).replace('HTML_SLIDES',html_slides).replace('NOTES',notes)
(OUT/'kovan-pitch-deck.html').write_text(page)
(ROOT/'pitch-deck-20261026.html').write_text(page)

script=['# Kovan — 3-minute pitch and judge notes','',
        'Official order: cover → solution → PMF → technical workflow + demo → team.',
        'Main deck: 5 slides. Separate judge backup: 7 slides. Updated 26 October 2026.',
        'Team credits are intentionally open. Timing allows approximately 65 seconds for the demo.', '']
for i,s in enumerate(SLIDES):
    script += [f'## {"Backup" if s.backup else "Slide"} {s.n}: {s.title}', '', s.notes, '']
(OUT/'PITCH.md').write_text('\n'.join(script))
(OUT/'layout-check.json').write_text(json.dumps({'slides':len(SLIDES),'warnings':WARNINGS,'main':5,'backup':7},indent=2))
print(json.dumps({'main':5,'backup':7,'warnings':WARNINGS,'output':str(OUT)},indent=2))
