import { useLayer, type Lang, LANGS } from "@/lib/layer";
import { UI_CACHE, useLangDicts } from "./dict-store";

/**
 * Site chrome dictionary: every user-facing string in menus, headers, table controls, entity page headings,
 * footer, 404 and the small labels around them. English (UK spelling) is the source of truth; the other eight
 * languages must define every key (enforced by the `UiDict` type and by src/lib/i18n/i18n.test.ts).
 *
 * Key families:
 *   plain ids        "home", "show", "toolbar.count"           chrome strings, may hold {placeholders}
 *   status.<status>  "status.phase-3"                          STATUS labels shown in tables and chips
 *   kind.<kind>.*    "kind.drug.plural", "kind.drug.title"     KIND_META names and plurals
 *   country.<code>   "country.US"                              region toggle
 *   l.<English>      "l.Open problems"                         headings, field labels, facet and column labels,
 *                                                              looked up by their English text (see `tl`)
 *
 * Body text (summaries, evidence, sources) is not in here: TL;DR translations live in src/data/i18n and the
 * rest stays English, with <html lang> set so the browser can offer translation.
 */
export const EN = {
  // ---- common ----
  home: "Home",
  show: "Show",
  hide: "Hide",
  reset: "Reset",
  clear: "Clear",
  all: "All",
  any: "Any",
  filter: "Filter",
  search: "Search",
  menu: "Menu",
  close: "Close",
  open: "Open",
  selected: "selected",
  none: "none",
  top: "top",
  save: "Save",
  cancel: "Cancel",
  remove: "Remove",
  download: "Download",
  breadcrumb: "Breadcrumb",
  sections: "Sections",
  loading: "Loading",
  "sections.of": "{name} sections",
  primaryNav: "Primary",

  // ---- tables and facets ----
  name: "Name",
  "toolbar.count": "{count} {noun}",
  "toolbar.countOf": "{count} of {total} {noun}",
  "table.noMatches": "No matches.",
  "table.nothingMatches": "Nothing matches. Clear a filter.",
  "table.showAll": "Show all {n} rows",
  "table.showingFirst": "(showing the first {n})",
  "table.showMore": "Show {n} more",
  "table.scroll": "Scroll the table",
  "table.moreItems": "+{n} more",
  "table.moreItemsTip": "Also: {list}. Click to show all {total}.",
  "table.firstApproval": "First approval {first}, latest {last}",
  "table.loadingMore": "Loading more rows…",
  "table.sortBy": "Sort by {col}",
  "table.sortedAsc": "Sorted ascending. Click to flip.",
  "table.sortedDesc": "Sorted descending. Click to flip.",
  "table.filterNoun": "Filter {noun}",
  "table.searchIn": "Search {label}",
  "table.clearLabel": "Clear {label}",
  "table.nSelected": "{n} selected",
  "table.filterBy": "Filter by {facet}: {value}",
  "table.filteringBy": "Filtering by {facet}: {value}. Click to clear.",
  "table.filterCol": "Filter by {col}",
  "table.filteringCol": "Filtering by {col}: {value}",
  "table.saveView": "Save view",
  "table.saveViewTitle": "Save these filters, search and sort under a name (stored in this browser only)",
  "table.saved": "Saved",
  "table.viewSaved": "View saved",
  "table.removeSaved": "Remove this saved view",
  "table.viewName": "Name for this view",

  // ---- header ----
  "header.home": "OnCo home",
  "header.search": "Search",
  "header.openSearch": "Open search (Command K)",
  "header.askOnco": "Ask OnCo",
  "header.forMe": "For me",
  "header.cancerTypes": "Cancer types",
  "header.openMenu": "Open menu",
  "header.closeMenu": "Close menu",
  "header.openGroup": "Open {group}",
  "header.openGroupMenu": "Open {group} menu",
  "header.closeGroupMenu": "Close {group} menu",
  "header.overviewOf": "Overview of {group}",
  "header.switchesNote": "Country, language and theme switches are in the top bar.",
  "header.github": "OnCo on GitHub",
  "header.githubRepo": "GitHub repository",
  "header.stars": "{n} GitHub stars",
  "header.starsTitle": "{n} GitHub stars. Star the repo to help others find it.",
  "header.skip": "Skip to content",

  // ---- country (approvals) toggle ----
  "region.global": "Global",
  "region.globalBlurb": "Every region shown as flags; country-specific pages hidden from menus",
  "region.allRegulators": "all regulators shown as flags",
  "region.aria": "Approvals shown for {region}. Change country",
  "region.title": "Approvals shown for {region} ({regulator}). Click to change country.",
  "region.listbox": "Country for approvals",
  "region.intro": "Which regulator decides what {approved} means on every page. Other countries' approvals stay visible as flags.",
  "region.approved": "approved",
  "region.useBrowser": "Use my browser's country",
  "country.US": "United States",
  "country.EU": "European Union",
  "country.UK": "United Kingdom",
  "country.JP": "Japan",
  "country.CN": "China",
  "country.AU": "Australia",
  "country.IN": "India",

  // ---- theme ----
  "theme.system": "Auto",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.contrast": "High contrast",
  "theme.title": "Theme: {current}. Click for {next}.",
  "theme.aria": "Theme: {current}. Switch to {next}",

  // ---- reading level and language ----
  "layer.aria": "Reading level and site language",
  "layer.readingLevel": "Reading level",
  "layer.siteLanguage": "Site language",
  "layer.blurb": "Menus, headings, table labels and the TL;DR on each page are translated where a translation exists. TL;DR translations are machine-assisted and unreviewed; where one is missing, the English TL;DR is shown with an EN mark. Detailed summaries, evidence tables and sources stay in English, and your browser can translate them.",
  "level.technical": "Technical",
  "level.plain": "Plain",
  "level.simple": "Simple",
  "level.technical.blurb": "Full summaries for clinicians and scientists",
  "level.plain.blurb": "Plain-language TL;DRs only",
  "level.simple.blurb": "Even simpler, about a 12-year-old reading age",
  "layer.hiddenNote": "The {label} is hidden in {mode} mode.",
  "layer.showTechnical": "Show technical",
  "layer.technicalSummary": "technical summary",
  "tldr.en": "EN",
  "tldr.enTitle": "No translation yet; showing English. Propose one via Suggest an edit.",
  "tldr.reviewed": "Reviewed",
  "tldr.reviewedTitle": "Translation reviewed by {reviewer} on {date}.",
  "tldr.mt": "MT",
  "tldr.mtTitle": "Machine-assisted translation, not yet reviewed by a named speaker. Report a problem via Suggest an edit.",
  "summary.mt": "Machine translated from the English",
  "summary.mtReport": "report a problem",
  "summary.showEnglish": "Show the English",
  "summary.showTranslation": "Show in {lang}",

  // ---- translation strip under the header ----
  "strip.text": "Headings and menus are in {language}. Detailed text is in English; your browser can translate the rest.",
  "strip.help": "How to translate a page in {browser}",
  "strip.dismiss": "Dismiss",

  // ---- translate offer at the top of the main column (src/components/TranslateOffer.tsx) ----
  "offer.english": "This page is in English. Your browser can translate it.",
  "offer.chrome": "In Chrome, right-click the page and choose Translate.",
  "offer.edge": "In Edge, right-click the page and choose Translate.",
  "offer.safari": "In Safari, use the translate button in the address bar.",
  "offer.firefox": "In Firefox, click the translate icon in the address bar.",
  "offer.other": "Look for a translate option in your browser's menu.",
  "offer.switch": "OnCo is also available in {language}.",
  "offer.switchButton": "Switch to {language}",

  // ---- analytics consent (bar at the foot of the viewport, footer control, /privacy/ panel) ----
  "consent.text": "OnCo uses Google Analytics to help improve the site.",
  "consent.allow": "Allow",
  "consent.decline": "No thanks",
  "consent.choice": "Analytics choice",
  "consent.state.granted": "allowed",
  "consent.state.denied": "off",
  "consent.state.unset": "not chosen",
  "consent.gpc": "Your browser sent a Global Privacy Control signal, so analytics stay off unless you allow them here.",

  // ---- footer ----
  "footer.about": "A public, cited, editable map of oncology: technologies, targets, products, companies, institutions, pathways, trials, pairings, roadmaps, and ideas. One page per object, with a plain-language TL;DR on every page.",
  "footer.wip": "Work in progress.",
  "footer.disclaimer": "Every fact on this site is being built and checked in the open and may be incomplete, out of date, or wrong. You must do your own research and verify anything here at its primary source before relying on it. Nothing on this site is medical advice; decisions belong with you and your clinicians.",
  "footer.medical": "OnCo is an information resource, not medical advice. Nothing here replaces a conversation with a qualified clinician. Never delay care because of something you read here; in an emergency, call your local emergency services.",
  "footer.terms": "Terms of use",
  "footer.privacy": "Privacy policy",
  "footer.commercial": "Commercial licences",
  "footer.madeBy": "Made with heart and soul by",
  "footer.licence": "© 2026 OnCo. Code MIT. The data are free for individual and educational use with the attribution “Data from OnCo (onco.cc)”, under CC BY-NC 4.0. Commercial use must contact us to pay for the data.",
  "footer.aboutLink": "About and methodology",
  "footer.corrections": "Corrections",
  "footer.api": "Open API",

  // ---- 404 ----
  "notFound.title": "Not in the map yet",
  "notFound.body": "That page does not exist. Search for what you meant, or {link}.",
  "notFound.link": "ask for it to be added",

  // ---- suggest an edit card ----
  "suggest.follow": "Follow this page",
  "suggest.wrong": "Improve the information",
  "suggest.body": "Propose a change with a source. Organisations can update their own records. Every suggestion is reviewed, safety-checked and validated before it goes live; nothing is edited directly.",
  "suggest.cta": "Suggest an edit",
  "suggest.stale": "Out of date?",
  "suggest.staleTitle": "Something here has been overtaken by events",
  "suggest.readout": "Report a readout",
  "suggest.readoutTitle": "This trial has reported or been updated",
  "suggest.approval": "Report an approval",
  "suggest.approvalTitle": "Approved, filed, or withdrawn in another region",
  "suggest.how": "How review works",
  "watch.watch": "Watch",
  "watch.watching": "Watching",
  "watch.blocked": "Saved for this visit only: your browser blocks site storage.",
  "watch.feed": "Follow by feed",
  "watch.feedTitle": "Atom feed of every change on OnCo, for a feed reader",
  "watch.saved": "Saved",
  "watch.added": "Added to your watchlist. Saved will show what changes on this page.",
  "watch.removed": "Removed from your watchlist.",
  "watch.title": "Watch this page: Saved will show what changed since you last looked. Stored in this browser only.",
  "watch.titleOn": "Watching. You will see what changed on this page since your last visit under Saved. Click to stop.",
  "discuss.link": "Discuss",
  "discuss.title": "Find discussion threads about {name} on GitHub",
  "discuss.new": "start a thread",
  "discuss.newTitle": "Start a new thread about this object",

  // ---- survival folds ----
  "survival.show": "Show survival figures ({n})",
  "survival.note": "Averages across everyone diagnosed, often years ago. A median is the middle of a group: half the people counted lived longer than the figure shown, and some lived far longer. Your stage, subtype, age, fitness and the treatment you receive matter more than the average, and the numbers are improving quickly.",

  // ---- statuses ----
  "status.approved": "Approved",
  "status.phase-3": "Phase 3",
  "status.phase-2": "Phase 2",
  "status.phase-1": "Phase 1",
  "status.preclinical": "Preclinical",
  "status.concept": "Concept",
  "status.standard-of-care": "Standard of care",
  "status.established": "Established",
  "status.emerging": "Emerging",
  "status.historic": "Historic",
  "status.withdrawn": "Withdrawn",
  "status.active": "Active",
  "status.completed": "Completed",
  "status.recruiting": "Recruiting",
  "status.positive": "Positive",
  "status.negative": "Negative",
  "status.mixed": "Mixed",
  "status.planned": "Planned",

  // ---- kinds ----
  "kind.cancer.label": "Cancer", "kind.cancer.plural": "cancers",
  "kind.section.label": "Front", "kind.section.plural": "fronts", "kind.section.title": "Fronts of the war on cancer",
  "kind.technology.label": "Technology", "kind.technology.plural": "technologies",
  "kind.target.label": "Target", "kind.target.plural": "targets",
  "kind.drug.label": "Treatment", "kind.drug.plural": "drugs", "kind.drug.title": "Treatments & tests",
  "kind.company.label": "Company", "kind.company.plural": "companies",
  "kind.institution.label": "Institution", "kind.institution.plural": "institutions",
  "kind.pathway.label": "Pathway", "kind.pathway.plural": "pathways",
  "kind.term.label": "Term", "kind.term.plural": "terms", "kind.term.title": "Glossary",
  "kind.trial.label": "Trial", "kind.trial.plural": "trials",
  "kind.pairing.label": "Pairing", "kind.pairing.plural": "pairings",
  "kind.roadmap.label": "Roadmap", "kind.roadmap.plural": "roadmaps",
  "kind.idea.label": "Idea", "kind.idea.plural": "ideas",
  "kind.collection.label": "Collection", "kind.collection.plural": "collections",
  "kind.person.label": "Person", "kind.person.plural": "people",
  "kind.journal.label": "Journal", "kind.journal.plural": "journals",
  "kind.paper.label": "Key paper", "kind.paper.plural": "key papers",
  "kind.bottleneck.label": "Bottleneck", "kind.bottleneck.plural": "bottlenecks", "kind.bottleneck.title": "Bottlenecks of the war on cancer",
  "kind.biomarker.label": "Biomarker", "kind.biomarker.plural": "biomarkers", "kind.biomarker.title": "Biomarkers & readouts",
  "kind.year.label": "Year", "kind.year.plural": "years", "kind.year.title": "Oncology year by year",

  // ---- headings, field labels, facet and column labels (looked up by English text) ----
  "l.Summary": "Summary",
  "l.Overview": "Overview",
  "l.Sources": "Sources",
  "l.sources, at the foot of the page": "sources, at the foot of the page",
  "l.Every source this page cites, grouped by who published it. Grouping is read from the web address, not assigned by hand.": "Every source this page cites, grouped by who published it. Grouping is read from the web address, not assigned by hand.",
  "l.A source that has moved or gone is reported by the weekly link check.": "A source that has moved or gone is reported by the weekly link check.",
  "l.Sources & links": "Sources & links",
  "l.Related": "Related",
  "l.Connected": "Connected",
  "l.Notes": "Notes",
  "l.Wikipedia": "Wikipedia",
  "l.Tags": "Tags",
  "l.Data": "Data",
  "l.Phase / status": "Phase / status",
  "l.Status": "Status",
  "l.What is being done about this": "What is being done about this",
  "l.Available now": "Available now",
  "l.In trials": "In trials",
  "l.Ideas and roadmaps": "Ideas and roadmaps",
  "l.Open problems": "Open problems",
  "l.Open problems and what is being done": "Open problems and what is being done",
  "l.Open questions": "Open questions",
  "l.Treatments & tests": "Treatments & tests",
  "l.Trials": "Trials",
  "l.People": "People",
  "l.Key papers": "Key papers",
  "l.Latest papers": "Latest papers",
  "l.Papers": "Papers",
  "l.Cases by country": "Cases by country",
  "l.State of the art": "State of the art",
  "l.Outlook": "Outlook",
  "l.Standard of care": "Standard of care",
  "l.Subtypes & biomarkers": "Subtypes & biomarkers",
  "l.Subtypes": "Subtypes",
  "l.Biomarkers clinicians test": "Biomarkers clinicians test",
  "l.How often this target appears": "How often this target appears",
  "l.History": "History",
  "l.Pipeline": "Pipeline",
  "l.Expert centres": "Expert centres",
  "l.Questions to ask": "Questions to ask",
  "l.Related pages": "Related pages",
  "l.Trials recruiting now": "Trials recruiting now",
  "l.Landmark trials": "Landmark trials",
  "l.Anatomy and lymph node drainage": "Anatomy and lymph node drainage",
  "l.Preclinical models": "Preclinical models",
  "l.Who gets it and what has changed": "Who gets it and what has changed",
  "l.Group": "Group",
  "l.Advanced disease": "Advanced disease",
  "l.Treatment journeys": "Treatment journeys",
  "l.How it works": "How it works",
  "l.Strengths": "Strengths",
  "l.Limitations": "Limitations",
  "l.Generation": "Generation",
  "l.Since": "Since",
  "l.Model registry": "Model registry",
  "l.External identifiers": "External identifiers",
  "l.Mutation hotspots": "Mutation hotspots",
  "l.Companion diagnostics": "Companion diagnostics",
  "l.Biology": "Biology",
  "l.Where it is found": "Where it is found",
  "l.Class": "Class",
  "l.How drugs attack it": "How drugs attack it",
  "l.Modality": "Modality",
  "l.Purpose": "Purpose",
  "l.Mechanism": "Mechanism",
  "l.Brand / code": "Brand / code",
  "l.Payload": "Payload",
  "l.Linker": "Linker",
  "l.Where it is approved": "Where it is approved",
  "l.Approvals": "Approvals",
  "l.Region": "Region",
  "l.Year": "Year",
  "l.Indication": "Indication",
  "l.Safety": "Safety",
  "l.Regulatory": "Regulatory",
  "l.Cost & access": "Cost & access",
  "l.Outcomes": "Outcomes",
  "l.Regimens": "Regimens",
  "l.Programmes": "Programmes",
  "l.Products": "Products",
  "l.Headquarters": "Headquarters",
  "l.Type": "Type",
  "l.Website": "Website",
  "l.Archived website": "Archived website",
  "l.Y Combinator profile": "Y Combinator profile",
  "l.Founded": "Founded",
  "l.Location": "Location",
  "l.Newsweek 2026 oncology rank": "Newsweek 2026 oncology rank",
  "l.NCI designation": "NCI designation",
  "l.OnCo score": "OnCo score",
  "l.Analogy": "Analogy",
  "l.Category": "Category",
  "l.Methods and models": "Methods and models",
  "l.Setting": "Setting",
  "l.Phase": "Phase",
  "l.Sponsor": "Sponsor",
  "l.Registry": "Registry",
  "l.Headline result": "Headline result",
  "l.Reported": "Reported",
  "l.Enrolled": "Enrolled",
  "l.Replication": "Replication",
  "l.Rationale": "Rationale",
  "l.Evidence": "Evidence",
  "l.Confidence": "Confidence",
  "l.Hypothesis": "Hypothesis",
  "l.Proposed test": "Proposed test",
  "l.Maturity": "Maturity",
  "l.Cost to try": "Cost to try",
  "l.Years to first evidence": "Years to first evidence",
  "l.Bottlenecks it attacks": "Bottlenecks it attacks",
  "l.Authors": "Authors",
  "l.Published": "Published",
  "l.Full text": "Full text",
  "l.Findings": "Findings",
  "l.What it means": "What it means",
  "l.Caveats": "Caveats",
  "l.Publisher": "Publisher",
  "l.Scope": "Scope",
  "l.Access model": "Access model",
  "l.ISSN": "ISSN",
  "l.Scale of the problem": "Scale of the problem",
  "l.Root causes": "Root causes",
  "l.Current efforts": "Current efforts",
  "l.Success criteria": "Success criteria",
  "l.Relief available today": "Relief available today",
  "l.Ideas to fix it": "Ideas to fix it",
  "l.Technologies that relieve it": "Technologies that relieve it",
  "l.URL": "URL",
  "l.Holds": "Holds",
  "l.Licence": "Licence",
  "l.Maintainer": "Maintainer",
  "l.Dataset registry": "Dataset registry",
  "l.Role": "Role",
  "l.Institution": "Institution",
  "l.Specialisms": "Specialisms",
  "l.Specialism": "Specialism",
  "l.Profiles": "Profiles",
  "l.Story": "Story",
  "l.Steps": "Steps",
  "l.Diagram": "Diagram",
  "l.Technologies": "Technologies",
  "l.Technology": "Technology",
  "l.Cancers": "Cancers",
  "l.Cancer": "Cancer",
  "l.Fronts": "Fronts",
  "l.Front": "Front",
  "l.Targets": "Targets",
  "l.Target": "Target",
  "l.Companies": "Companies",
  "l.Company": "Company",
  "l.Institutions": "Institutions",
  "l.Pathways": "Pathways",
  "l.Terms": "Terms",
  "l.Product": "Product",
  "l.Journal": "Journal",
  "l.Bottleneck": "Bottleneck",
  "l.Title": "Title",
  "l.Access": "Access",
  "l.ADC payload": "ADC payload",
  "l.Approved": "Approved",
  "l.Care settings": "Care settings",
  "l.Cost": "Cost",
  "l.Country": "Country",
  "l.Current": "Current",
  "l.Druggable nodes": "Druggable nodes",
  "l.Emerging": "Emerging",
  "l.First": "First",
  "l.Second": "Second",
  "l.History events": "History events",
  "l.HQ": "HQ",
  "l.Impact factor": "Impact factor",
  "l.Linked objects": "Linked objects",
  "l.Links": "Links",
  "l.NCI": "NCI",
  "l.Newsweek 2026": "Newsweek 2026",
  "l.Nodes": "Nodes",
  "l.Papers listed": "Papers listed",
  "l.Practice": "Practice",
  "l.Score": "Score",
  "l.Severity": "Severity",
  "l.Stage": "Stage",
  "l.Tag": "Tag",
  "l.Who acts": "Who acts",
  "l.See all": "See all",
  "l.What it is": "What it is",
  "l.Types and stages": "Types and stages",
  "l.Finding it": "Finding it",
  "l.Treating it": "Treating it",
  "l.Treatment": "Treatment",
  "l.The science": "The science",
  "l.Biology and targets": "Biology and targets",
  "l.Where you are": "Where you are",
  "l.Countries and centres": "Countries and centres",
  "l.Living with it": "Living with it",
  "l.Decisions and support": "Decisions and support",
  "l.What is coming": "What is coming",
  "l.Pipeline and open problems": "Pipeline and open problems",
  "l.Symptoms and diagnosis": "Symptoms and diagnosis",
  "l.Milestones": "Milestones",
  "l.Machine-readable versions": "Machine-readable versions",
  "l.In development": "In development",
  "l.What changed": "What changed",
  "l.Decision aids": "Decision aids",
  "l.UK and NHS": "UK and NHS",
  "l.Decisions you may face": "Decisions you may face",
  "account.signInCta": "Sign in/up",
  "account.email": "Email address",
  "signup.title": "Stay in the loop",
  "signup.why": "Leave your email and OnCo will write when something big changes in cancer research. No spam, one click to unsubscribe.",
  "signup.button": "Keep me posted",
  "signup.done": "Thank you. You are on the list.",
  "signup.icon": "Your profile and email updates",
  "signup.soon": "Email updates open shortly. Until then, press Watch on any page to keep it on your list.",

  // ---- idea rankings (/ideas/rankings/) ----
  "rank.pill": "Rankings",
  "rank.title": "Idea rankings",
  "rank.lede": "Six ways to order the same {n} ideas, each built from fields the records already carry: how many people the linked cancers affect each year (GLOBOCAN 2022), how many cancers an idea spans, how much evidence is linked, its cost band, its horizon and its maturity. Every score shows its formula; nothing is estimated.",
  "rank.allIdeas": "All ideas",
  "rank.viewsAria": "Ranking views",
  "rank.view.bang-for-buck": "Best bang for buck",
  "rank.view.most-important": "Most important",
  "rank.view.hardest": "Hardest",
  "rank.view.closest-to-reality": "Closest to reality",
  "rank.view.cherry-picked": "Cherry picked",
  "rank.view.most-wanted": "Most wanted",
  "rank.formula.bang-for-buck": "Score = burden (annual new cases of the linked cancers, GLOBOCAN 2022) divided by the cost band (small 1, medium 2, large 3) and divided again by one plus the horizon in years; ties go to more evidence.",
  "rank.formula.most-important": "Score = burden times breadth (the number of linked cancers); ties go to more evidence.",
  "rank.formula.hardest": "Score = cost band (1 to 3) plus horizon years divided by 5, plus distance from being tested at scale (0 to 3), plus missing evidence (3 minus linked evidence, never below 0); ties go to more burden.",
  "rank.formula.closest-to-reality": "Score = maturity rank (speculative 1 to being tested at scale 4) times 3, plus linked evidence; ties go to more burden.",
  "rank.formula.cherry-picked": "An editorial list kept by hand in src/data/idea-picks.ts, seeded from the ideas that rank best across the four computed views, with one sentence of reasoning each.",
  "rank.formula.most-wanted": "Thumbs-up on each idea's GitHub discussion thread, counted weekly into public/votes.json.",
  "rank.excluded.bang-for-buck": "no linked cancer with a GLOBOCAN site estimate, or no cost band or horizon recorded",
  "rank.excluded.most-important": "no linked cancer with a GLOBOCAN site estimate",
  "rank.excluded.hardest": "no cost band or horizon recorded",
  "rank.top": "Top {n} of the {total} ideas this view can rank.",
  "rank.notRanked": "{n} of {total} ideas are not ranked here: {why}.",
  "rank.noVotes": "Most wanted is hidden until the first vote is counted: public/votes.json has no thumbs-up yet. Open an idea, follow Discuss and give the first post a thumbs-up.",
  "rank.editPicks": "Picks edited by hand in src/data/idea-picks.ts, shown in the order listed there.",
  "rank.score": "Score",
  "rank.part.burden": "Burden",
  "rank.part.breadth": "Cancers",
  "rank.part.evidence": "Evidence",
  "rank.part.cost": "Cost",
  "rank.part.horizon": "Horizon",
  "rank.part.maturity": "Maturity",
  "rank.years": "{n} yr",
  "rank.casesYear": "cases/yr",
  "rank.reason": "Why it is picked",
  "rank.more": "+{n} more",
  "rank.source": "Burden figures are world estimates of new cases, both sexes, all ages, fetched {date}; a subtype with no site of its own uses its parent's site, and each site counts once per idea. Source:",
} as const;

export type UiKey = keyof typeof EN;
export type UiDict = Record<UiKey, string>;

/**
 * The other eight dictionaries are not imported here: dict-store.ts fetches a language's files the first time a
 * reader needs them and fills UI_CACHE, so `t` answers in English until then. Tests and scripts that want every
 * language at once import src/lib/i18n/all.ts.
 */
const dictFor = (lang: Lang): UiDict => (lang === "en" ? EN : UI_CACHE[lang] ?? EN);

export type Vars = Record<string, string | number>;

function fill(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The chrome string for `key` in `lang`, with {placeholders} filled from `vars`. Falls back to English. */
export function t(key: UiKey, lang: Lang, vars?: Vars): string {
  const d = dictFor(lang);
  return fill(d[key] ?? EN[key], vars);
}

/** A string for a key that may not exist (dynamic keys such as `status.${s}`); undefined when unknown. */
export function tOpt(key: string, lang: Lang, vars?: Vars): string | undefined {
  if (!(key in EN)) return undefined;
  return t(key as UiKey, lang, vars);
}

/**
 * Translate a heading, field label, facet or column label by its English text. Unknown labels pass through
 * unchanged, so pages can keep passing plain English strings and only the common ones are translated.
 */
export function tl(label: string, lang: Lang): string {
  return tOpt(`l.${label}`, lang) ?? label;
}

/** Status label ("Phase 3", "Approved") in `lang`; unknown statuses pass through. */
export function statusLabel(status: string, lang: Lang): string {
  return tOpt(`status.${status}`, lang) ?? status;
}

/** Kind name in `lang`: singular label, plural, or the public title where one exists ("Treatments & tests"). */
export function kindName(kind: string, form: "label" | "plural" | "title", lang: Lang): string | undefined {
  if (form === "title") return tOpt(`kind.${kind}.title`, lang) ?? tOpt(`kind.${kind}.plural`, lang);
  return tOpt(`kind.${kind}.${form}`, lang);
}

const PLURAL_KEYS = (Object.keys(EN) as UiKey[]).filter((k) => k.startsWith("kind.") && k.endsWith(".plural"));

/** Translate a table noun that is a kind plural ("drugs" becomes "medicamentos"); other nouns pass through. */
export function tNoun(noun: string, lang: Lang): string {
  if (lang === "en") return noun;
  const k = PLURAL_KEYS.find((key) => EN[key] === noun);
  return k ? t(k, lang) : noun;
}

/** Text direction for a language. Only Arabic is right-to-left among the supported set. */
export function dirFor(lang: Lang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/** The language's own name ("Español"), for the strip and the toggle. */
export function langNative(lang: Lang): string {
  return LANGS.find((l) => l.code === lang)?.native ?? lang;
}

/**
 * Client hook: the current site language plus bound helpers. Built on `useLayer`, so the first client render
 * matches the server (English) and swaps after hydration.
 */
export function useT() {
  const [layer] = useLayer();
  const lang = layer.lang;
  // Fetches the language's dictionaries on first use and re-renders this component when they arrive (English until then).
  useLangDicts(lang);
  return {
    lang,
    dir: dirFor(lang),
    t: (key: UiKey, vars?: Vars) => t(key, lang, vars),
    tOpt: (key: string, vars?: Vars) => tOpt(key, lang, vars),
    tl: (label: string) => tl(label, lang),
    status: (s: string) => statusLabel(s, lang),
    noun: (n: string) => tNoun(n, lang),
    kind: (k: string, form: "label" | "plural" | "title") => kindName(k, form, lang),
  };
}
