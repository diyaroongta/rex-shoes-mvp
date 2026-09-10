from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether
)

OUT = Path("/Users/diyaroongta/Downloads/factory-os/outputs/factory-os-costing/Factory_OS_Complete_Cost_and_Quotation.pdf")

FONT = "/System/Library/Fonts/Supplemental/Verdana.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Verdana Bold.ttf"
pdfmetrics.registerFont(TTFont("Verdana", FONT))
pdfmetrics.registerFont(TTFont("Verdana-Bold", FONT_BOLD))

NAVY = colors.HexColor("#17324D")
BLUE = colors.HexColor("#2563EB")
TEAL = colors.HexColor("#0F766E")
AMBER = colors.HexColor("#B45309")
RED = colors.HexColor("#B91C1C")
INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#5B6875")
GRID = colors.HexColor("#D9E1E8")
PALE_BLUE = colors.HexColor("#EAF2FF")
PALE_GREEN = colors.HexColor("#E8F5F1")
PALE_AMBER = colors.HexColor("#FFF4D6")
PALE_RED = colors.HexColor("#FDECEC")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CoverTitle", fontName="Verdana-Bold", fontSize=25, leading=31, textColor=colors.white, spaceAfter=8))
styles.add(ParagraphStyle(name="CoverSub", fontName="Verdana", fontSize=11, leading=17, textColor=colors.HexColor("#DCE8F5")))
styles.add(ParagraphStyle(name="H1x", fontName="Verdana-Bold", fontSize=17, leading=22, textColor=NAVY, spaceAfter=10))
styles.add(ParagraphStyle(name="H2x", fontName="Verdana-Bold", fontSize=11, leading=15, textColor=colors.white, backColor=BLUE, borderPadding=(5,7,5,7), spaceBefore=8, spaceAfter=7))
styles.add(ParagraphStyle(name="Bodyx", fontName="Verdana", fontSize=8.7, leading=13, textColor=INK, spaceAfter=6))
styles.add(ParagraphStyle(name="Smallx", fontName="Verdana", fontSize=7.2, leading=10.3, textColor=MUTED))
styles.add(ParagraphStyle(name="Callout", fontName="Verdana-Bold", fontSize=10, leading=15, textColor=NAVY, backColor=PALE_BLUE, borderPadding=9, borderColor=BLUE, borderWidth=0.7, spaceBefore=7, spaceAfter=9))
styles.add(ParagraphStyle(name="Warn", fontName="Verdana-Bold", fontSize=9, leading=13, textColor=AMBER, backColor=PALE_AMBER, borderPadding=8, borderColor=AMBER, borderWidth=0.6, spaceBefore=7, spaceAfter=9))
styles.add(ParagraphStyle(name="TinyLink", fontName="Verdana", fontSize=6.6, leading=9.2, textColor=MUTED))
styles.add(ParagraphStyle(name="TableCell", fontName="Verdana", fontSize=7.2, leading=9.4, textColor=INK))
styles.add(ParagraphStyle(name="TableCellBold", fontName="Verdana-Bold", fontSize=7.2, leading=9.4, textColor=INK))
styles.add(ParagraphStyle(name="TableHead", fontName="Verdana-Bold", fontSize=7.1, leading=9, textColor=NAVY))
styles.add(ParagraphStyle(name="KPI", fontName="Verdana-Bold", fontSize=15, leading=18, textColor=NAVY, alignment=TA_CENTER))
styles.add(ParagraphStyle(name="KPILabel", fontName="Verdana", fontSize=7, leading=9, textColor=MUTED, alignment=TA_CENTER))

def p(text, style="TableCell"):
    return Paragraph(str(text), styles[style])

def money_inr(v):
    return f"₹{v/100000:.2f}L" if abs(v) >= 100000 else f"₹{v:,.0f}"

def page_header(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, h-13*mm, w, 13*mm, fill=1, stroke=0)
    canvas.setFont("Verdana-Bold", 8.5)
    canvas.setFillColor(colors.white)
    canvas.drawString(17*mm, h-8.2*mm, "FACTORY OS  |  COSTING & COMMERCIAL MODEL")
    canvas.setFont("Verdana", 7)
    canvas.drawRightString(w-17*mm, h-8.2*mm, "Prepared 9 September 2026")
    canvas.setStrokeColor(GRID)
    canvas.line(17*mm, 13*mm, w-17*mm, 13*mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Verdana", 6.8)
    canvas.drawString(17*mm, 8.5*mm, "Budgetary model; confirm taxes, insurance, legal terms and external-service quotes before contract.")
    canvas.drawRightString(w-17*mm, 8.5*mm, f"Page {doc.page}")
    canvas.restoreState()

doc = BaseDocTemplate(
    str(OUT), pagesize=A4, leftMargin=17*mm, rightMargin=17*mm,
    topMargin=20*mm, bottomMargin=17*mm,
    title="Factory OS Complete Cost and Quotation",
    author="Factory OS"
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=page_header)])

# Model calculations
fx_factor = 88 * 1.035 * 1.18
shared_prod = 124
client_expected = 55 + 149.88 + 5 + 5 + 2
platform_expected = shared_prod + client_expected
platform_guardrail = 154 + 772
dev_tools = 200 + 200 + 100 + 100 + 4 + 24.95 + 25
one_client_cash = (platform_expected + dev_tools) * fx_factor
guardrail_cash = (platform_guardrail + dev_tools) * fx_factor
launch_subtotal = dev_tools * 6 * fx_factor + 250000 + 125000 + 50000 + 125000 + 150000 + 50000
launch_cash = launch_subtotal * 1.20
founder_build = 840 * 2500
quote_setup = 1000000
quote_monthly = 150000
contract_value = quote_setup + quote_monthly * 24

story = []

# Cover
cover = Table([[Paragraph("FACTORY OS", styles["CoverTitle"]), ""],
               [Paragraph("Complete end-to-end costing, production readiness plan and proposed quotation", styles["CoverSub"]), ""]],
              colWidths=[150*mm, 25*mm], rowHeights=[38*mm, 31*mm])
cover.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), NAVY),
    ("SPAN", (0,0), (1,0)), ("SPAN", (0,1), (1,1)),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 12*mm),
    ("RIGHTPADDING", (0,0), (-1,-1), 12*mm),
]))
story += [Spacer(1, 15*mm), cover, Spacer(1, 10*mm)]
story.append(Paragraph("Scope locked", styles["H2x"]))
scope_data = [
    [p("20", "KPI"), p("15", "KPI"), p("26", "KPI"), p("12", "KPI"), p("2", "KPI"), p("1", "KPI")],
    [p("named users", "KPILabel"), p("concurrent", "KPILabel"), p("days/month", "KPILabel"), p("hours/day", "KPILabel"), p("locations", "KPILabel"), p("legal entity", "KPILabel")],
]
scope = Table(scope_data, colWidths=[29*mm]*6, rowHeights=[11*mm, 8*mm])
scope.setStyle(TableStyle([("BOX",(0,0),(-1,-1),0.5,GRID),("INNERGRID",(0,0),(-1,-1),0.3,GRID),("BACKGROUND",(0,0),(-1,-1),colors.white),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
story += [scope, Spacer(1, 7*mm)]
story.append(Paragraph(
    f"Recommended founding-client commercial: <b>₹10L implementation + ₹1.50L/month</b>, GST extra, for a 24-month value of <b>{money_inr(contract_value)}</b>. "
    f"Fund approximately <b>{money_inr(launch_cash)}</b> cash before official launch and carry about <b>{money_inr(one_client_cash)}/month</b> while only one client exists.",
    styles["Callout"]
))
story.append(Paragraph("This model deliberately does not use the numbers in the supplied Google Sheet. It borrows only the useful structure—identify every cost, add margin, and convert that into a quotation. It also supersedes the earlier two-page PDF, which materially undercounted production AI, database reliability, support continuity and the economics of a solo founder.", styles["Bodyx"]))
story.append(Spacer(1, 3*mm))
story.append(Paragraph("Core conclusion", styles["H2x"]))
story.append(Paragraph("The cheapest cloud bill is not the cost of delivering Factory OS. The complete cost has five layers: client-specific runtime; shared production services; Claude/Codex development capacity; one-time official-launch assurance; and founder time/support. Healthy margins come from reusing one codebase across several isolated client deployments—not from assuming credits never run out or pricing the founder at zero.", styles["Bodyx"]))
story.append(PageBreak())

# 2 Architecture and usage
story.append(Paragraph("1. What is actually being costed", styles["H1x"]))
story.append(Paragraph("Factory OS is a React/Vite ERP-style production planning application with Vercel serverless APIs, Postgres/Neon persistence and Claude-powered document reading/copilot features. The planning engine itself should remain deterministic; AI reads documents and explains results.", styles["Bodyx"]))
story.append(Paragraph("Recommended deployment boundary", styles["H2x"]))
arch = [
    [p("Layer","TableHead"), p("1–5 clients","TableHead"), p("Why","TableHead"), p("Later trigger","TableHead")],
    [p("Code","TableCellBold"), p("One shared repository and release line"), p("Every security/performance fix reaches every client"), p("Never create a client fork without an explicit product decision")],
    [p("Application"), p("Separate Vercel project per client, under one team"), p("Deployment and environment isolation"), p("Automate provisioning after repeatable product fit")],
    [p("Database"), p("Separate Neon project/database per client"), p("Clear backup, export and blast-radius boundary"), p("Evaluate true multi-tenancy only after mature controls")],
    [p("Two locations"), p("One client database with mandatory site ID"), p("Stock, capacity, WIP and dispatch cannot mix silently"), p("Separate only if the client requires legal/operational isolation")],
]
t = Table(arch, colWidths=[27*mm, 53*mm, 56*mm, 39*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F8FAFC")]),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [t, Spacer(1, 4*mm)]
story.append(Paragraph("Usage estimate from the current product", styles["H2x"]))
usage = [
    [p("Driver","TableHead"), p("Expected/month","TableHead"), p("Guardrail","TableHead"), p("Implication","TableHead")],
    [p("Active concurrent user-hours"), p("4,680"), p("9,360"), p("15 concurrent × 12 hours × 26 days")],
    [p("Function invocations"), p("≈697,840"), p("≈1.42M"), p("Current 60-second orders/dispatch polling dominates")],
    [p("Response transfer after file fix"), p("≈161 GB"), p("≈670 GB"), p("Inside Vercel allowance only if list responses stay lean")],
    [p("Stored files after 24 months"), p("≈17 GB"), p("≈34 GB"), p("Includes 30% versioning/metadata headroom")],
    [p("Database after 24 months"), p("≈11.6 GB"), p("≈23.2 GB"), p("Structured records only; no base64 document bodies")],
]
t = Table(usage, colWidths=[48*mm, 33*mm, 31*mm, 63*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F8FAFC")]),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [t]
story.append(Paragraph("Critical present-state issue: PI attachments and catalogue images can live as base64 inside database JSON, while list endpoints can return that JSON repeatedly. This can hit Vercel's 4.5 MB function request/response limit and magnify bandwidth. Externalizing files, signed URLs, pagination and lean list records are launch work—not optional optimization.", styles["Warn"]))
story.append(PageBreak())

# 3 runtime
story.append(Paragraph("2. Monthly runtime and capacity reserve", styles["H1x"]))
story.append(Paragraph("Expected cost is the modeled consumption. The guardrail is the funded subscription/credit/usage capacity that should be available so a busy month does not stop the ERP.", styles["Bodyx"]))
runtime = [
    [p("Cost head","TableHead"), p("Expected US$","TableHead"), p("Funded guardrail US$","TableHead"), p("Allocation","TableHead"), p("What it buys","TableHead")],
    [p("Vercel Pro"), p("20"), p("40"), p("Shared"), p("Hosting, CDN, functions, WAF and overage room")],
    [p("Monitoring + incident response"), p("64"), p("64"), p("Shared"), p("Telemetry, uptime and on-call workflow")],
    [p("Transactional email"), p("20"), p("20"), p("Shared"), p("Password resets, alerts and reports")],
    [p("Security scanning"), p("20"), p("30"), p("Shared"), p("Dependencies, secrets and application checks")],
    [p("Neon Scale"), p("55"), p("100"), p("Per client"), p("Warm production, staging, 30-day PITR and enterprise controls")],
    [p("Anthropic production API"), p("150"), p("500"), p("Per client"), p("Document reads, copilot, retries and funded reserve")],
    [p("Object storage"), p("5"), p("10"), p("Per client"), p("Private slips, PIs, images, imports and versions")],
    [p("Independent backup"), p("5"), p("10"), p("Per client"), p("Daily encrypted dump, 90-day retention, restore drill")],
    [p("Domain/DNS"), p("2"), p("2"), p("Per client"), p("Client endpoint allocation")],
    [p("SSO/SCIM reserve"), p("0"), p("125"), p("Optional"), p("Enterprise identity connection")],
    [p("WhatsApp/SMS reserve"), p("0"), p("25"), p("Optional"), p("Provider usage; not included by default")],
    [p("Production total","TableCellBold"), p(f"{platform_expected:,.0f}","TableCellBold"), p(f"{platform_guardrail:,.0f}","TableCellBold"), p("One client","TableCellBold"), p("Excludes developer subscriptions","TableCellBold")],
]
t = Table(runtime, colWidths=[47*mm, 27*mm, 32*mm, 24*mm, 45*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("ROWBACKGROUNDS",(0,1),(-1,-2),[colors.white,colors.HexColor("#F8FAFC")]),("BACKGROUND",(0,-1),(-1,-1),PALE_GREEN),("LINEABOVE",(0,-1),(-1,-1),0.8,TEAL),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]))
story += [t, Spacer(1, 4*mm)]
story.append(Paragraph("Solo development capacity", styles["H2x"]))
dev = [
    [p("Tool","TableHead"), p("US$/month","TableHead"), p("Role","TableHead")],
    [p("Claude Max 20×"), p("200"), p("Primary product development")],
    [p("ChatGPT Pro / Codex"), p("200"), p("Code generation, review and testing")],
    [p("Claude overflow credits"), p("100"), p("Agentic/batch overflow with cap")],
    [p("Codex flexible credits"), p("100"), p("Work beyond included usage with cap")],
    [p("GitHub + 1Password + misc."), p("≈54"), p("Source control, secret recovery and small services")],
    [p("Total","TableCellBold"), p(f"{dev_tools:,.0f}","TableCellBold"), p("Shared company operating cost","TableCellBold")],
]
t = Table(dev, colWidths=[60*mm, 35*mm, 80*mm])
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("BACKGROUND",(0,-1),(-1,-1),PALE_AMBER),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]))
story += [t]
story.append(Paragraph(f"One client therefore needs about <b>{money_inr(one_client_cash)}/month</b> expected cash including the shared development tool stack, currency uplift and GST. Carry roughly <b>{money_inr(guardrail_cash)}/month</b> of funded capacity. GST may be creditable; confirm treatment with the CA.", styles["Callout"]))
story.append(PageBreak())

# AI
story.append(Paragraph("3. AI budget and no-exhaustion design", styles["H1x"]))
ai_table = [
    [p("Workload","TableHead"), p("Expected calls/month","TableHead"), p("Tokens/call in / out","TableHead"), p("Expected US$","TableHead"), p("Stress US$","TableHead")],
    [p("Order slip extraction"), p("598"), p("4,500 / 1,200"), p("18.84"), p("59.20")],
    [p("PI extraction"), p("260"), p("8,000 / 3,000"), p("17.94"), p("57.72")],
    [p("ERP copilot"), p("936"), p("25,000 / 600"), p("78.62"), p("252.72")],
    [p("Background evals/retries"), p("100"), p("10,000 / 1,000"), p("4.50"), p("18.00")],
    [p("With reserve","TableCellBold"), p("—"), p("—"), p("≈149.88","TableCellBold"), p("≈445.78","TableCellBold")],
]
t = Table(ai_table, colWidths=[50*mm, 36*mm, 39*mm, 25*mm, 25*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("ROWBACKGROUNDS",(0,1),(-1,-2),[colors.white,colors.HexColor("#F8FAFC")]),("BACKGROUND",(0,-1),(-1,-1),PALE_GREEN),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [t, Spacer(1, 5*mm)]
story.append(Paragraph("Controls to configure before production", styles["H2x"]))
controls = [
    [p("Control","TableHead"), p("Recommended setting","TableHead"), p("Why","TableHead")],
    [p("Anthropic organization tier"), p("Build tier; $1,000 monthly cap"), p("Expected and stress usage fit without an organization-level stop")],
    [p("Production workspace"), p("$750 workspace cap; alerts at 50/75/90%"), p("Contains anomalies while leaving headroom")],
    [p("Prepaid credits"), p("Auto-reload below $200 back to a $500 balance; backup card"), p("Prepaid balance exhaustion otherwise stops API calls")],
    [p("Per-user usage"), p("Soft warning, admin override and usage dashboard"), p("One noisy user cannot consume the whole client allowance")],
    [p("Failure path"), p("Save to manual review queue; exponential retry; never lose the upload"), p("Document intake continues through 429s/timeouts")],
    [p("Model governance"), p("Keep deterministic planning; AI only extracts/explains"), p("A model change cannot silently alter production calculations")],
]
t = Table(controls, colWidths=[42*mm, 63*mm, 70*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F8FAFC")]),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [t]
story.append(Paragraph("The expected token estimate uses Claude Sonnet 4.6 because that is what the current code pins. Its listed pricing is $3 per million input tokens and $15 per million output tokens. A model migration may lower unit cost, but it should happen only after an extraction-quality regression set is in place.", styles["Smallx"]))
story.append(PageBreak())

# Launch
story.append(Paragraph("4. One-time official-launch investment", styles["H1x"]))
launch = [
    [p("Cash workstream","TableHead"), p("Budget ₹","TableHead"), p("What completion means","TableHead")],
    [p("Six-month Claude/Codex/dev-tool runway"), p(money_inr(dev_tools*6*fx_factor)), p("Subscriptions and overflow limits funded through hardening")],
    [p("Independent penetration test"), p("₹2.50L"), p("Report, remediation and retest evidence")],
    [p("Legal, privacy, IP and DPA"), p("₹1.25L"), p("MSA, SOW, DPA, privacy terms and IP chain")],
    [p("Accounting/tax/business setup"), p("₹0.50L"), p("GST/invoicing and financial treatment confirmed")],
    [p("Laptop/test devices/UPS/backup internet"), p("₹1.25L"), p("Solo-founder operational continuity tested")],
    [p("First-client migration/UAT/training/travel"), p("₹1.50L"), p("Two-site reconciliation, signed UAT and training record")],
    [p("Disaster recovery/release rehearsal"), p("₹0.50L"), p("Restore and rollback drill with timestamped evidence")],
    [p("Subtotal"), p(money_inr(launch_subtotal)), p("Before uncertainty reserve")],
    [p("20% contingency"), p(money_inr(launch_subtotal*.2)), p("Replace with quotes as vendors/client data are locked")],
    [p("Total launch cash","TableCellBold"), p(money_inr(launch_cash),"TableCellBold"), p("Funding gate before committing go-live","TableCellBold")],
]
t = Table(launch, colWidths=[66*mm, 28*mm, 81*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("ROWBACKGROUNDS",(0,1),(-1,-2),[colors.white,colors.HexColor("#F8FAFC")]),("BACKGROUND",(0,-1),(-1,-1),PALE_GREEN),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]))
story += [t, Spacer(1, 5*mm)]
story.append(Paragraph("Founder time is separate", styles["H2x"]))
story.append(Paragraph(f"The launch plan includes <b>840 founder hardening hours</b> valued at ₹2,500/hour = <b>{money_inr(founder_build)}</b> economic investment. It covers location-aware data, audit logs, object storage, MFA/SSO readiness, staging/E2E tests, observability/backups, polling reduction, migration and UAT. This is not immediate cash salary, but it must be visible when evaluating payback or outside investment.", styles["Callout"]))
story.append(Paragraph("The earlier agency/team build estimate is therefore replaced by two transparent numbers: launch cash and founder economic time. They should never be collapsed into one figure because they answer different questions—cash runway versus product investment.", styles["Bodyx"]))
story.append(PageBreak())

# Quotation
story.append(Paragraph("5. Proposed client quotation", styles["H1x"]))
quote = [
    [p("Line item","TableHead"), p("Founding client","TableHead"), p("Later standard","TableHead"), p("Billing","TableHead")],
    [p("Implementation and go-live"), p("₹10.00L"), p("₹12.00L"), p("50% start / 30% UAT / 20% go-live")],
    [p("Managed subscription"), p("₹1.50L/month"), p("₹1.75L/month"), p("Quarterly in advance")],
    [p("Initial term"), p("24 months"), p("24–36 months"), p("8% annual price revision")],
    [p("Scope"), p("20 users, 2 locations, 1 entity"), p("Same base scope"), p("Additional scope priced separately")],
]
t = Table(quote, colWidths=[48*mm, 41*mm, 41*mm, 45*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("BACKGROUND",(0,1),(-1,1),PALE_GREEN),("ROWBACKGROUNDS",(0,2),(-1,-1),[colors.white,colors.HexColor("#F8FAFC")]),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [t, Spacer(1, 5*mm)]
story.append(Paragraph("Included allowances", styles["H2x"]))
allow = [
    [p("Meter","TableHead"), p("Included/month","TableHead"), p("Overage","TableHead")],
    [p("AI document reads"), p("1,000 slips + PIs"), p("₹25/additional document")],
    [p("Copilot requests"), p("1,500"), p("₹10/additional request")],
    [p("Private file storage"), p("25 GB"), p("₹100/additional GB/month")],
    [p("Email notifications"), p("10,000"), p("Provider overage + 20% service margin")],
    [p("WhatsApp/SMS"), p("Not included"), p("Provider usage + 20% service margin")],
    [p("Additional user"), p("20 base users"), p("₹2,000/user/month")],
    [p("Additional location"), p("2 base sites"), p("₹25,000/month + ₹2L setup")],
    [p("Additional legal entity"), p("1 base entity"), p("₹35,000/month + scoped setup")],
]
t = Table(allow, colWidths=[56*mm, 50*mm, 69*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F8FAFC")]),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]))
story += [t]
story.append(Paragraph("Commercial protection", styles["H2x"]))
story.append(Paragraph("The SOW should define modules, migration volumes, acceptance tests, support hours/severity, usage metering, data ownership/export/deletion, third-party subprocessors, change requests, annual revision and liability. Do not promise a financially backed 99.9% SLA while the company has one operational person; make service credits a paid premium only after coverage exists.", styles["Warn"]))
story.append(PageBreak())

# Multi client
story.append(Paragraph("6. Why the business needs multiple clients", styles["H1x"]))
story.append(Paragraph("Shared development and production services spread across clients; the Neon database, AI runtime, private files and backups remain client-specific. Support is valued at ₹2,500/hour using 30 hours/month for the first client plus 8 hours for each additional client.", styles["Bodyx"]))
multi = [
    [p("Clients","TableHead"), p("Cash cost/client","TableHead"), p("Support h/month","TableHead"), p("True cost/client","TableHead"), p("Margin at ₹1.50L","TableHead"), p("Operating decision","TableHead")],
]
for n in [1,2,3,5,10,25]:
    total_cash = (shared_prod + dev_tools + n*client_expected) * fx_factor
    cash_pc = total_cash/n
    support_h = 30 + 8*(n-1)
    support_pc = support_h*2500/n
    true_pc = cash_pc + support_pc
    margin = (quote_monthly-true_pc)/quote_monthly
    decision = "Founder-led" if n <= 3 else "Add support help" if n <= 5 else "Hire support/QA" if n <= 10 else "Not viable as solo operation"
    multi.append([p(str(n)), p(money_inr(cash_pc)), p(str(support_h)), p(money_inr(true_pc)), p(f"{margin:.1%}"), p(decision)])
t = Table(multi, colWidths=[20*mm, 33*mm, 31*mm, 33*mm, 31*mm, 27*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F8FAFC")]),("BACKGROUND",(0,4),(-1,4),PALE_GREEN),("BACKGROUND",(0,6),(-1,6),PALE_RED),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [t, Spacer(1, 5*mm)]
story.append(Paragraph("Interpretation", styles["H2x"]))
story.append(Paragraph("At one client, the ₹1.50L monthly price is a market-entry price and does not fully cover founder support plus the entire shared tool stack. Around five clients, modeled true cost falls to roughly ₹71k/client and the quote produces about 53% gross margin. Around ten, it reaches about 62%, close to the 65% steady-state target—but 102 support hours/month means staffing must already exist.", styles["Callout"]))
story.append(Paragraph("Do not create a separate codebase for each company. Client-specific code forks destroy this cost curve because fixes, testing and deployment multiply. The permitted customization mechanism should be configuration, feature flags and scoped integrations from one shared release line.", styles["Warn"]))
story.append(PageBreak())

# launch gates and sources
story.append(Paragraph("7. Launch gates and source basis", styles["H1x"]))
gates = [
    [p("Priority","TableHead"), p("Launch gate","TableHead"), p("Evidence before go-live","TableHead")],
    [p("P0"), p("Files out of database JSON; lean and paginated APIs"), p("Largest client dataset stays below limits; signed URL tests")],
    [p("P0"), p("Site ID throughout stock, capacity, WIP, orders and dispatch"), p("Two-location isolation/reconciliation tests")],
    [p("P0"), p("AI credits, caps, alerts and fallback queue"), p("Forced 429 and zero-credit drill without data loss")],
    [p("P0"), p("Credential recovery and continuity runbook"), p("Backup owner can deploy, restore and revoke access")],
    [p("P1"), p("MFA and optional SSO/SCIM"), p("Role/access tests and security review")],
    [p("P1"), p("Daily independent backup and quarterly restore"), p("Measured RPO/RTO and restored staging copy")],
    [p("P1"), p("Load and end-to-end tests against live staging Postgres"), p("15/30-concurrent-user p95 and failure-rate report")],
    [p("P1"), p("Monitoring and incident workflow"), p("Synthetic alert and escalation drill")],
]
t = Table(gates, colWidths=[20*mm, 74*mm, 81*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCE4EC")),("GRID",(0,0),(-1,-1),0.35,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("BACKGROUND",(0,1),(0,4),PALE_RED),("BACKGROUND",(0,5),(0,-1),PALE_AMBER),("ROWBACKGROUNDS",(1,1),(-1,-1),[colors.white,colors.HexColor("#F8FAFC")]),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [t, Spacer(1, 5*mm)]
story.append(Paragraph("Primary official sources", styles["H2x"]))
sources = [
    ("Vercel Pro plan", "https://vercel.com/docs/plans/pro-plan"),
    ("Vercel Functions usage/pricing", "https://vercel.com/docs/functions/usage-and-pricing"),
    ("Vercel Functions limits", "https://vercel.com/docs/functions/limitations"),
    ("Neon pricing and Scale capabilities", "https://neon.com/pricing"),
    ("Anthropic Sonnet 4.6", "https://platform.claude.com/docs/en/models/sonnet-4-6/overview"),
    ("Anthropic API rate limits", "https://platform.claude.com/docs/en/api/rate-limits"),
    ("Anthropic prepaid usage credits", "https://support.anthropic.com/en/articles/8977456-how-do-i-pay-for-my-api-usage"),
    ("ChatGPT pricing", "https://openai.com/chatgpt/pricing"),
    ("Codex flexible usage credits", "https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-freegopluspro-sora"),
    ("Better Stack pricing", "https://betterstack.com/pricing"),
    ("Resend pricing", "https://resend.com/pricing"),
]
for name, url in sources:
    story.append(Paragraph(f'• <link href="{url}" color="#2563EB">{name}</link>', styles["TinyLink"]))
story.append(Spacer(1, 4*mm))
story.append(Paragraph("Model boundary", styles["H2x"]))
story.append(Paragraph("Vendor prices and limits can change. The workbook holds editable assumptions, formulas and the full source list. Penetration testing, legal, travel, insurance, communications and staffing are budgetary allowances until written quotes and the client's data/security requirements are known. Currency uses ₹88/US$, 3.5% card/forex uplift and 18% GST for cash planning.", styles["Smallx"]))

OUT.parent.mkdir(parents=True, exist_ok=True)
doc.build(story)
print(str(OUT))
