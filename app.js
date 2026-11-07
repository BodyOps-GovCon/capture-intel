/* Capture Intelligence screens. Reads the sidecar project. Since file 0019, Go and No go are sent to GovCon OS and
   Research next asks GovCon OS's research run for the checks picked; tasks and notes are saved only here. */
(function () {
  "use strict";
  var cfg = window.CI_CONFIG || {};
  var page = document.body.getAttribute("data-page");
  var client = null;
  var me = null;

  var TYPE = { priced_bid: "Priced bid", market_research: "Market research", future_bid: "Future bid",
    contract_vehicle: "Contract vehicle", subcontract_route: "Subcontract route", contract_ending: "Contract ending", unknown: "Type unknown" };
  var DECISION = { go: "Go", no_go: "No go", research_next: "Research next" };
  var FACTOR = { type: "Type", value: "Value", relevance: "Relevance", eligibility: "Eligibility", competition: "Competition",
    effort: "Effort", urgency: "Urgency", attractiveness: "Attractiveness", decision: "Suggested decision", action: "Action" };
  var STATUS = { open: "Open", in_progress: "In progress", blocked: "Blocked", done: "Done", dropped: "Dropped" };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var OWNER = { "PHLUX": "You", "Virtual assistant": "Assistant", "GovCon OS": "GovCon OS", "Not assigned": "Not assigned" };
  // The commercial recommendation (file 0010) and its chip color.
  var REC_CLASS = { pursue: "High", investigate: "Medium", watch: "Info", pass: "Muted" };
  var POSITION_CLASS = { Strong: "High", Some: "Medium", Weak: "Low", "Not known": "Muted" };
  var CATEGORIES = ["Documents and access", "Deadline verification", "Qualification research", "Proposal preparation", "Follow-up and coordination"];

  function $(sel, el) { return (el || document).querySelector(sel); }
  function all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) {
    return s == null ? "" : String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function chip(text, cls) { return '<span class="chip ' + esc(cls || text) + '">' + esc(text) + "</span>"; }
  function tag(label) { return '<span class="tag ' + esc(label) + '">' + esc(label) + "</span>"; }
  function plural(n, one, many) { return esc(n) + " " + (Number(n) === 1 ? one : (many || one + "s")); }
  function num(n) { return n == null ? "0" : Number(n).toLocaleString("en-US"); }
  function clip(s, n) {
    if (!s) return "";
    s = String(s);
    if (s.length <= n) return s;
    return s.slice(0, n + 1).replace(/\s+\S*$/, "").replace(/[ ,;:-]+$/, "") + " …";
  }
  function link(url, text) {
    if (!url || !/^https?:\/\//i.test(url)) return "";
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(text || "Open the notice") + "</a>";
  }
  function monthLabel(m) {
    var x = /^(\d{4})-(\d{2})$/.exec(m || "");
    return x ? MONTHS[Number(x[2]) - 1] + " " + x[1] : (m || "");
  }
  // "Thu 5 Nov, 12:00 PM" in Los Angeles time; the date alone when no time of day is on record.
  var fmt = null;
  function shortDate(iso, noTime) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    try {
      fmt = fmt || new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", day: "numeric", month: "short",
        year: "numeric", hour: "numeric", minute: "2-digit" });
      var p = {};
      fmt.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      var thisYear = new Date().getFullYear() === Number(p.year);
      return p.weekday + " " + p.day + " " + p.month + (thisYear ? "" : " " + p.year) + (noTime ? "" : ", " + p.hour + ":" + p.minute + " " + p.dayPeriod);
    } catch (e) { return d.toISOString().slice(0, 16).replace("T", " ") + " UTC"; }
  }
  function setMain(html) { $("#main").innerHTML = html; }
  // These screens read answers added by database file 0010 (profit-first pursuit intelligence), which runs after file
  // 0008 as joined with file 0009. Without it, say so instead of showing a half-empty page.
  function old0008() {
    setMain('<div class="panel"><h2>One step left</h2><p>These screens need database file 0010 ' +
      "(CAPTURE_INTEL_0010_run_in_Body_Ops_Capture_Intel.sql). Run it in the SQL Editor of the Body Ops Capture Intel project, " +
      "then reload this page.</p></div>");
  }
  function recChip(p) { return p ? chip(p.label, REC_CLASS[p.recommendation] || "Muted") : ""; }
  function ownerOf(p, v) {
    var o = p ? p.owner : (v || {}).owner;
    return ownerText(o) + (p && p.owner_note ? '<div class="subtle">' + esc(p.owner_note) + "</div>" : "");
  }
  function pDeadline(p) {
    if (!p || !p.deadline_at) return '<span class="subtle">None due</span>';
    return '<div class="when-strong">' + esc(shortDate(p.deadline_at, p.deadline_has_time === false)) + '</div><div class="subtle">' + esc(p.deadline_what || "") + "</div>";
  }
  // The commercial view of one item, for its details (evidence stays on expansion).
  function commercialHtml(p, rules) {
    if (!p) return "";
    var pass = p.recommendation === "pass";
    return '<h3>Commercial view</h3><dl class="kv">' +
      "<dt>Recommendation</dt><dd>" + recChip(p) + " " + esc(p.reason) + "</dd>" +
      (p.next_action ? "<dt>Next action</dt><dd>" + esc(p.next_action) + "</dd>" : "") +
      (pass ? "" : "<dt>Who pays</dt><dd>" + esc(p.payer) + "</dd>") +
      "<dt>Business upside</dt><dd>" + esc(p.upside) + ". " + esc(p.share) + "</dd>" +
      (pass ? "" : "<dt>Profit</dt><dd>" + esc(p.profit) + "</dd>") +
      (!pass && p.costs ? "<dt>Costs to plan for</dt><dd>On record: " + esc(p.costs) + ".</dd>" : "") +
      (pass ? "" : "<dt>Our position</dt><dd>" + chip(p.advantage, POSITION_CLASS[p.advantage] || "Muted") + (p.advantage_why ? " " + esc(p.advantage_why) : "") + "</dd>") +
      (pass ? "" : "<dt>Effort versus return</dt><dd>" + (p.effort_flag ? chip("Big effort for uncertain revenue", "Low") + " " : "") + esc(p.effort) + "</dd>") +
      (p.strategic && !pass ? "<dt>Strategic value</dt><dd>" + esc(p.strategic) + "</dd>" : "") +
      "<dt>Decision history</dt><dd>" + (p.history_incomplete ? chip("History incomplete", "Low") + " " : "") + esc(p.history) + "</dd>" +
      (p.change_text ? "<dt>Changes</dt><dd>" + (p.change_check === "material" ? chip("Verified material change", "Medium") + " " : "") + esc(p.change_text) + "</dd>" : "") +
      "<dt>What the copy cannot see</dt><dd>" + esc(p.snapshot) + "</dd></dl>" +
      (rules ? rule(rules.recommendation, "How the recommendation is chosen") + rule(rules.upside, "How the upside is shown") +
        rule(rules.position, "How our position is rated") + rule(rules.changes, "How changes since a no-go are checked") : "");
  }
  function fail(err) {
    var m = err && (err.message || err.error_description || err);
    if (/ci_home/i.test(String(m || "")) && /(Could not find|does not exist)/i.test(String(m || ""))) { old0008(); return; }
    setMain('<div class="panel"><h2>Something went wrong</h2><p>' + esc(m) + "</p><p>Reload the page. If it happens again, tell Claude what this box says.</p></div>");
  }
  function rpc(name, args) {
    return client.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function isPhlux() { return (me.seats || []).indexOf("phlux") >= 0; }
  function ownerText(o) { return o ? (OWNER[o] || o) : "—"; }
  function typeText(t) { return TYPE[t] || t || ""; }
  function worthClass(stage) {
    return { approved: "High", qualified: "High", research: "Medium", responded: "Info", bid_sent: "Info", watch: "Info" }[stage] || "Muted";
  }
  function worthChip(v) { return v ? chip(v.worth, worthClass(v.stage)) : ""; }
  function deadlineShort(v) {
    if (!v || !v.deadline_at) return "";
    return shortDate(v.deadline_at, v.deadline_has_time === false);
  }
  function deadlineCell(v) {
    if (!v || !v.deadline_at) return '<span class="subtle">None due</span>';
    return '<div class="when-strong">' + esc(deadlineShort(v)) + '</div><div class="subtle">' + esc(v.deadline_what || "") + "</div>";
  }
  function valueBlock(value, words, note) {
    if (!value) return '<span class="subtle">Unknown</span>';
    return '<span class="money">' + esc(value) + '</span><div class="subtle">' + esc(words || "") + "</div>";
  }
  function section(id, title, body, extra) {
    return '<section class="panel" id="' + id + '"><div class="sec-head"><h2>' + esc(title) + "</h2>" + (extra || "") + "</div>" + body + "</section>";
  }
  function rule(text, label) {
    return text ? '<details class="howto"><summary>' + esc(label || "How this is chosen") + "</summary><p>" + esc(text) + "</p></details>" : "";
  }

  // ---------------------------------------------------------------- sign in
  function showSignIn(note) {
    $("#who").innerHTML = "";
    $("#copybar").innerHTML = "<strong>Not signed in.</strong><span>Nothing is shown until you sign in.</span>";
    setMain('<div class="panel signin"><h1>Sign in</h1><p class="lede">Enter your email address. We send you a sign-in link; ' +
      "open it on this device.</p>" + (note ? '<p class="notice">' + esc(note) + "</p>" : "") +
      '<form id="signin"><label for="email">Email address</label><input id="email" type="email" required autocomplete="email">' +
      '<button class="primary" type="submit">Send me a sign-in link</button></form><p class="status" id="signin-status" aria-live="polite"></p></div>');
    $("#signin").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("#email").value.trim();
      var st = $("#signin-status");
      var btn = $("#signin button");
      btn.disabled = true;
      st.textContent = "Sending...";
      client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href.split("#")[0].split("?")[0] } })
        .then(function (r) {
          btn.disabled = false;
          st.textContent = r.error ? "Could not send the link: " + r.error.message
            : "Check your email for the sign-in link. It can take a minute to arrive.";
        });
    });
  }

  function header() {
    var seats = (me && me.seats) || [];
    var label = seats.indexOf("phlux") >= 0 ? "PHLUX" : seats.indexOf("va") >= 0 ? "Virtual assistant" : "No seat";
    $("#who").innerHTML = "<span>" + esc(me.email) + " &middot; " + esc(label) + '</span><button class="small" id="signout">Sign out</button>';
    $("#signout").addEventListener("click", function () {
      $("#signout").disabled = true;
      client.auth.signOut().finally(function () { location.reload(); });
    });
    var c = me.copy;
    var bar = $("#copybar");
    if (!c) { bar.innerHTML = "<strong>No copy loaded yet.</strong>"; return; }
    bar.innerHTML = "<strong>" + (c.source === "live" ? "Live copy of GovCon OS" : "Test copy (sanitized)") + "</strong>" +
      "<span>loaded " + esc(c.taken_at_la) + "</span><span>" + plural(num(c.rows), "row") + "</span>" +
      "<span>" + (me.live_connection ? "live connection on" : "live connection to GovCon OS not switched on yet") + "</span>" +
      (seats.indexOf("phlux") >= 0 ? '<button class="small" id="refresh">Refresh</button><span id="refresh-status" class="status" aria-live="polite"></span>' : "");
    var rb = $("#refresh");
    if (rb) rb.addEventListener("click", function () {
      rb.disabled = true;
      rpc("ci_request_refresh").then(function (r) { $("#refresh-status").textContent = r.message || r.status; })
        .catch(function (e) { $("#refresh-status").textContent = e.message; }).finally(function () { rb.disabled = false; });
    });
  }

  function needsPhlux() {
    if (isPhlux()) return false;
    setMain('<div class="panel"><h2>This screen is for the PHLUX seat</h2><p>Your seat shows the <a href="va.html">virtual assistant queue</a>.</p></div>');
    return true;
  }

  // ---------------------------------------------------------------- shared detail pieces
  function evidenceHtml(item, open) {
    var rows = (item.evidence || []).map(function (e) {
      return '<div class="row"><div class="head"><b>' + esc(FACTOR[e.factor] || e.factor) + "</b>" + tag(e.label) + "</div>" +
        "<p>" + esc(e.statement) + "</p>" +
        (e.quote ? "<blockquote>" + esc(e.quote) + "</blockquote>" : "") +
        (e.source ? '<div class="src">Source: ' + esc(e.source) + "</div>" : "") +
        (e.rule ? '<div class="rule">' + esc(e.rule) + "</div>" : "") + "</div>";
    }).join("");
    return '<details class="evidence"' + (open ? " open" : "") + '><summary>Evidence for every rating</summary><div class="legend">' +
      "<span>" + tag("Fact") + " from a GovCon OS record</span><span>" + tag("Derived") + " arithmetic on facts</span><span>" +
      tag("Assessment") + " a written rule</span><span>" + tag("Unknown") + ' not on record</span></div><div class="ev">' + rows + "</div></details>";
  }
  function ratingsLine(i) {
    return '<div class="meta">' + chip("Value: " + i.value_rating, i.value_rating) + chip("Relevance: " + i.relevance_rating, i.relevance_rating) +
      chip("Eligibility: " + i.eligibility_rating, i.eligibility_rating) + chip("Competition: " + i.competition_rating, i.competition_rating) +
      chip("Effort: " + i.effort_rating, "effort " + i.effort_rating) + "</div>";
  }
  function ev(i, f) { return (i.evidence || []).filter(function (e) { return e.factor === f; })[0] || {}; }
  // What the record shows, without the research rulings' own "cannot rule" text.
  var GENERIC = /cannot rule|No ruling on this contract yet|No check of the current holder|No set-aside is on record|^Whether it can compete is not known\.?$|^No contract value/i;
  function knownFacts(i) {
    var out = [];
    ["eligibility", "competition", "relevance"].forEach(function (f) {
      var e = ev(i, f);
      if (!e.statement || GENERIC.test(e.statement)) return;
      out.push(e.statement);
    });
    return out;
  }
  function uncertain(i) {
    var out = (i.missing || []).slice();
    if (i.view && i.view.not_confirmed) out.push(i.view.not_confirmed);
    return out;
  }
  function sourceText(i) {
    var v = i.view || {};
    return '<details class="evidence"><summary>Source text on record</summary><dl class="kv">' +
      "<dt>Status as recorded</dt><dd>" + esc(i.status_now || "None") + "</dd>" +
      (i.exact_action ? "<dt>Next step as recorded</dt><dd>" + esc(i.exact_action) + "</dd>" : "") +
      (v.blocker ? "<dt>What is blocking it</dt><dd>" + esc(v.blocker) + "</dd>" : "") +
      (i.suggested_why ? "<dt>Rule's suggestion</dt><dd>" + tag("Assessment") + " " + esc(DECISION[i.suggested_decision] || "") + ". " + esc(i.suggested_why) + "</dd>" : "") +
      "</dl></details>";
  }
  function itemTitle(i, withBuyer) {
    return '<div class="title">' + esc(i.title || "(no title on record)") + '</div><div class="num">' + esc(i.solicitation_number || "") +
      " &middot; " + esc(typeText(i.opportunity_type)) + "</div>" + (withBuyer && i.buyer ? '<div class="subtle">' + esc(clip(i.buyer, 90)) + "</div>" : "");
  }
  // The step after a go, for a qualified item: the record's next step without the "give your go" lead-in.
  function afterGo(a) { return (a || "").replace(/^Give your go or no go\.\s*(Next step on record:\s*)?/, ""); }
  function firstSentence(a) { var m = /^(.+?[.?!])(\s|$)/.exec(a || ""); return m ? m[1] : (a || ""); }

  // ---------------------------------------------------------------- 1. Today (home)
  function briefing() {
    if (needsPhlux()) return;
    rpc("ci_home").then(function (h) {
      if (!h) { setMain('<div class="panel">Nothing to show yet. A copy has to be loaded first.</div>'); return; }
      if (!h.views_version || String(h.views_version).indexOf("0010") !== 0) { old0008(); return; }
      var html = '<h1>Today</h1><p class="lede">Built ' + esc(h.built_at_la) + " from the copy shown above, with the decisions and task updates saved here. " +
        "Value first, urgency second, administrative steps last. Times are Los Angeles time.</p>";

      // A. priorities: at most three, value first, in the six columns
      var pri = h.priorities || [];
      var body = pri.length ? '<div class="table-wrap"><table class="rtable pri-table"><thead><tr><th scope="col">Opportunity</th>' +
        '<th scope="col">Why it is worth our time</th><th scope="col">Business upside</th><th scope="col">Exact next action</th>' +
        '<th scope="col">Owner</th><th scope="col">Deadline</th></tr></thead><tbody>' + pri.map(function (p, n) {
          return '<tr class="static"><td class="item" data-label="Opportunity"><div class="pri-line"><span class="pri-n" aria-hidden="true">' + (n + 1) + "</span>" +
            '<div><a class="title" href="opportunities.html#' + encodeURIComponent(p.item_key) + '">' + esc(p.title) + '</a><div class="num">' + esc(p.number) +
            " &middot; " + esc(typeText(p.type)) + "</div>" + recChip(p) + "</div></div></td>" +
            '<td data-label="Why it is worth our time">' + esc(p.worth) + "</td>" +
            '<td data-label="Business upside">' + esc(p.upside) + "</td>" +
            '<td class="action" data-label="Exact next action">' + esc(p.next_action || "None on record") + "</td>" +
            '<td class="half" data-label="Owner">' + esc(p.owner) + "</td>" +
            '<td class="half" data-label="Deadline">' + (p.deadline_words ? esc(p.deadline_what + " " + p.deadline_words) : '<span class="subtle">None due</span>') + "</td></tr>";
        }).join("") + "</tbody></table></div>" : "";
      if (h.priorities_note) body += '<p class="' + (pri.length ? "note-line" : "empty") + '">' + esc(h.priorities_note) + "</p>";
      body += '<p class="note-line"><a href="decisions.html">' + (h.decisions_ready ? plural(h.decisions_ready, "decision is", "decisions are") + " ready for you on the Decisions page"
        : "No decision is ready for you; the Decisions page lists the rest") + "</a></p>";
      html += section("today", "Your priorities today", body + rule(h.priorities_rule));

      // B. best opportunities, by the recommendation
      var top = h.top || [];
      var q = top.filter(function (x) { return x.group === "qualified"; });
      var pr = top.filter(function (x) { return x.group !== "qualified"; });
      var row = function (x) {
        // the chip already says it waits on the government; the reason need not say it again
        var reason = x.waiting_on === "government" ? (x.reason || "").replace(/^Waiting on the government \(file 0009\):\s*/, "") : x.reason;
        if (reason) reason = reason.charAt(0).toUpperCase() + reason.slice(1);
        x = Object.assign({}, x, { reason: reason });
        return '<li><a class="title" href="opportunities.html#' + encodeURIComponent(x.item_key) + '">' + esc(x.title) + "</a>" +
          '<div class="num">' + esc(x.number) + " &middot; " + esc(typeText(x.type)) + "</div>" +
          '<div class="meta">' + recChip(x) + (x.waiting_on === "government" ? chip("Waiting on the government", "Info") : "") +
          (x.advantage ? chip("Position: " + x.advantage, POSITION_CLASS[x.advantage] || "Muted") : "") + "</div>" +
          '<p><b>Upside:</b> ' + esc(clip(x.upside, 150)) + "</p>" +
          (x.reason ? '<p class="why">' + esc(clip(x.reason, 170)) + "</p>" : "") +
          "<p><b>Next:</b> " + esc(clip(x.next_action, 150)) + "</p>" +
          '<div class="meta"><span>' + esc((x.deadline_what || "") + " " + (x.deadline_words || "")) + "</span><span>Owner: " + esc(ownerText(x.owner)) + "</span></div></li>";
      };
      var rc = h.recommendation_counts || {};
      var bbody = '<div class="grid two inner"><div><h3>Best to pursue, or waiting on the government</h3>' + (q.length ? '<ul class="items">' + q.map(row).join("") + "</ul>"
        : '<p class="empty">None right now.</p>') + "</div>";
      bbody += "<div><h3>Worth a short check</h3>" + (pr.length ? '<ul class="items">' + pr.map(row).join("") + "</ul>" : '<p class="empty">None.</p>') + "</div></div>";
      bbody += '<p class="note-line">In all: ' + esc(num(rc.pursue)) + " to pursue, " + esc(num(rc.investigate)) + " to investigate briefly, " + esc(num(rc.watch)) +
        " to watch, " + esc(num(rc.pass)) + ' passed or deprioritized. <a href="opportunities.html">All opportunities</a></p>' + rule(h.top_rule);
      html += section("best", "Highest-value opportunities", bbody);
      html += '<div class="grid three">';

      // C. assistant
      var a = h.assistant || {};
      var cbody = '<p class="counts">' + esc(a.open) + " open &middot; " + esc(a.in_progress) + " in progress &middot; " + esc(a.blocked) + " blocked &middot; " +
        esc(a.overdue) + " overdue</p>" + (a.seat_note ? '<p class="subtle">' + esc(a.seat_note) + "</p>" : "");
      cbody += (a.next || []).length ? '<ul class="items compact">' + a.next.map(function (t) {
        return "<li><div><b>" + esc(t.short) + "</b>" + (t.count > 1 ? " " + chip("×" + t.count, "Info") : "") + '</div><div class="subtle">' +
          esc(clip(t.related_title, 70)) + (t.number ? " &middot; " + esc(t.number) : "") + '</div><div class="meta"><span>' + esc(STATUS[t.status] || t.status) +
          "</span><span>" + esc(t.owner_label) + "</span><span>" + (t.due_words ? "Due " + esc(t.due_words) : "No due date") + "</span>" +
          ((t.flags || []).length ? chip("Review", "Medium") : "") + "</div></li>";
      }).join("") + "</ul>" : '<p class="empty">No open task.</p>';
      cbody += '<p class="note-line"><a href="va.html">Open the assistant queue</a></p>';
      html += section("assistant", "What your assistant is handling", cbody);

      // D. risks
      var risks = h.risks || [];
      var dbody = risks.length ? '<ul class="items">' + risks.map(function (r) {
        var rec = { "Pursue": "pursue", "Investigate briefly": "investigate", "Watch": "watch", "Pass / deprioritize": "pass" }[r.recommendation];
        return "<li>" + chip(r.label, "Low") + (r.recommendation ? " " + chip(r.recommendation, REC_CLASS[rec] || "Muted") : "") +
          (r.title ? ' <a class="title" href="opportunities.html#' + encodeURIComponent(r.item_key) + '">' + esc(clip(r.title, 90)) + "</a>" : "") +
          (r.number ? ' <span class="num">' + esc(r.number) + "</span>" : "") + "<p>" + esc(r.text) + '</p><div class="meta"><span>Who resolves it: ' + esc(ownerText(r.owner)) + "</span>" +
          (r.kind === "task_review" || r.kind === "overdue_tasks" || r.kind === "unassigned_tasks" ? '<a href="va.html">Review the tasks</a>' : "") + "</div></li>";
      }).join("") + "</ul>" : '<p class="empty">Nothing needs intervention right now.</p>';
      dbody += '<p class="subtle">Items already in your priorities are not repeated here, and items recommended for a pass are left out.</p>';
      html += section("risks", "Risks and blockers", dbody);

      // E. pipeline snapshot
      var pp = h.pipeline || {};
      var st = function (n, label, sub) { return '<div class="stat"><b>' + esc(n == null ? "Not recorded" : num(n)) + "</b><span>" + esc(label) + "</span>" + (sub ? '<span class="subtle">' + esc(sub) + "</span>" : "") + "</div>"; };
      var ebody = '<div class="stats">' +
        st(pp.needs_qualifying, "need qualifying", num(pp.needs_qualifying_priced) + " priced bids, " + num(pp.needs_qualifying_contracts_ending) + " contracts ending") +
        st(pp.qualified, "qualified", (pp.approved ? num(pp.approved) + " approved by you" : "none approved yet") +
          (pp.qualified_waiting_on_government ? ", " + num(pp.qualified_waiting_on_government) + " waiting on the government" : "")) +
        st(pp.preparing, "proposals in preparation") +
        st(pp.submitted_waiting, "priced bids sent, waiting", pp.submitted_with_problem ? num(pp.submitted_with_problem) + " more with a problem on record" : "") +
        st(pp.awards, "awards recorded") + "</div>" +
        '<p class="subtle">Counts only. No figures of different bids are added together. ' + esc(num(pp.responses_sent)) + ' responses with no price are kept apart. <a href="pipeline.html">The pipeline</a></p>';
      html += section("pipeline", "Pipeline snapshot", ebody);
      html += "</div>";

      // Operational details
      var d = h.details || {}, dq = d.data_quality || {}, bs = d.by_stage || {};
      var stage = function (k, label) { return bs[k] ? "<li>" + esc(num(bs[k])) + " " + esc(label) + "</li>" : ""; };
      html += '<details class="panel ops"><summary>Operational details</summary><div class="grid">' +
        '<div><h3>Items in the copy</h3><ul class="plain">' +
        "<li>" + esc(num(d.items)) + " items: " + esc(num(d.federal)) + " federal notices, " + esc(num(d.state_local)) + " state and local leads, " + esc(num(d.contracts_ending)) + " contracts ending</li>" +
        stage("qualified", "qualified") + stage("approved", "approved by you") + stage("research", "still being researched") + stage("responded", "responded") +
        stage("bid_sent", "bid sent") + stage("watch", "watched under a newer number") + stage("likely_out", "probably out") + stage("closed", "closed") + stage("passed", "passed") +
        "<li>" + esc(num(d.open_priced_bids)) + " open priced bids, " + esc(num(d.market_research)) + " market research notices, " + esc(num(d.vehicles)) + " contract vehicles</li>" +
        (d.screened_out_open != null ? "<li>" + esc(num(d.screened_out_open)) + " open federal notices the daily screen ruled out</li>" : "") +
        (d.not_researched_ending_first ? "<li>Contracts ending not yet researched: the first ends " + esc(d.not_researched_ending_first) + "</li>" : "") +
        '</ul></div><div><h3>Data quality</h3><ul class="plain">' +
        "<li>" + plural(num(dq.rulings_resting_on_guesses), "research ruling rests", "research rulings rest") + " on a value that is not verified</li>" +
        "<li>" + plural(num(dq.rulings_on_moved_ground), "research ruling rests", "research rulings rest") + " on a value that changed since</li>" +
        "<li>" + plural(num(dq.items_with_no_value_on_record), "item has", "items have") + " no contract value on record</li>" +
        "<li>" + plural(num(dq.files_still_unread), "required file is", "required files are") + " still unread</li></ul></div></div></details>";
      setMain(html);
    }).catch(fail);
  }

  // ---------------------------------------------------------------- 2. Opportunities
  var FILTERS = [
    ["pursue", "Best to pursue"], ["investigate", "Investigate briefly"], ["watch", "Watch"], ["pass", "Pass / deprioritize"], ["all", "All records"]];
  var EMPTY = {
    pursue: "None is recommended for pursuit right now. Prospects waiting on the government are under Watch; opportunities worth a short check are under Investigate briefly.",
    investigate: "Nothing needs a short check right now.", watch: "Nothing to watch.", pass: "Nothing is passed or deprioritized.", all: "No records." };
  var oppState = { items: [], filter: "pursue", q: "", rules: null };
  function inFilter(i, f) {
    var p = i.pursuit || {};
    return f === "all" ? true : p.recommendation === f;
  }
  function opportunities() {
    if (needsPhlux()) return;
    rpc("ci_opportunities").then(function (items) {
      if (items && items.length && !items[0].pursuit) { old0008(); return; }
      oppState.items = items || [];
      oppState.rules = (oppState.items.filter(function (i) { return i.pursuit_rules; })[0] || {}).pursuit_rules || null;
      var tabs = FILTERS.map(function (f) {
        var n = oppState.items.filter(function (i) { return inFilter(i, f[0]); }).length;
        return '<button class="tab" data-f="' + f[0] + '" aria-pressed="' + (f[0] === oppState.filter) + '">' + esc(f[1]) + ' <span class="count">' + n + "</span></button>";
      }).join("");
      setMain('<h1>Opportunities</h1><p class="lede">One recommendation for each, value first: what is worth pursuing, what a short check would decide, ' +
        "what to watch, and what is passed or deprioritized, with the reason. Contract size alone never makes a pursuit. Select a row for the evidence.</p>" +
        '<div class="tabs" role="group" aria-label="Show">' + tabs + '</div><div class="filters"><label>Search<input type="text" id="f-q" placeholder="Title, number or buyer"></label>' +
        '<span class="status" id="f-count" aria-live="polite"></span></div>' +
        '<div class="table-wrap"><table class="opps rtable"><thead><tr><th scope="col">Opportunity</th><th scope="col">Recommendation</th>' +
        '<th scope="col">Business upside</th><th scope="col">Next action</th><th scope="col">Deadline</th><th scope="col">Owner</th></tr></thead>' +
        '<tbody id="rows"></tbody></table></div><div id="drawer"></div>' + rule((oppState.rules || {}).recommendation, "How the recommendation is chosen"));
      all(".tab").forEach(function (b) {
        b.addEventListener("click", function () {
          oppState.filter = b.getAttribute("data-f");
          all(".tab").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          drawRows();
        });
      });
      $("#f-q").addEventListener("input", function (e) { oppState.q = e.target.value.toLowerCase(); drawRows(); });
      drawRows();
      var key = decodeURIComponent((location.hash || "").slice(1));
      if (key && oppState.items.some(function (x) { return x.item_key === key; })) openItem(key);
    }).catch(fail);
  }
  function drawRows() {
    var s = oppState;
    var rows = s.items.filter(function (i) {
      return inFilter(i, s.filter) && (!s.q || ((i.solicitation_number || "") + " " + (i.title || "") + " " + (i.buyer || "")).toLowerCase().indexOf(s.q) >= 0);
    });
    rows.sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
    $("#f-count").textContent = rows.length + " shown of " + s.items.length;
    $("#rows").innerHTML = rows.length ? rows.map(function (i) {
      var p = i.pursuit || {};
      return '<tr data-key="' + esc(i.item_key) + '" tabindex="0"><td class="item" data-label="Opportunity">' + itemTitle(i) + "</td>" +
        '<td data-label="Recommendation">' + recChip(p) + '<div class="subtle">' + esc(clip(p.reason, 110)) + "</div></td>" +
        '<td data-label="Business upside">' + esc(clip(p.upside, 90)) + "</td>" +
        '<td class="action" data-label="Next action">' + (p.next_action ? esc(clip(p.next_action, 120)) : '<span class="subtle">None</span>') + "</td>" +
        '<td class="half" data-label="Deadline">' + pDeadline(p) + "</td>" +
        '<td class="half" data-label="Owner">' + (p.owner ? esc(ownerText(p.owner)) : '<span class="subtle">None</span>') + "</td></tr>";
    }).join("") : '<tr class="static"><td colspan="6" class="empty">' + esc(s.q ? "Nothing under this tab matches the search." : EMPTY[s.filter] || "Nothing under this tab.") + "</td></tr>";
    all("#rows tr[data-key]").forEach(function (tr) {
      tr.addEventListener("click", function () { openItem(tr.getAttribute("data-key")); });
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter") openItem(tr.getAttribute("data-key")); });
    });
  }
  function closeItem() {
    $("#drawer").innerHTML = "";
    document.removeEventListener("keydown", escClose);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  function escClose(e) { if (e.key === "Escape") closeItem(); }
  function openItem(key) {
    var i = oppState.items.filter(function (x) { return x.item_key === key; })[0];
    if (!i) return;
    var v = i.view || {}, p = i.pursuit || {};
    var know = knownFacts(i), unk = uncertain(i);
    $("#drawer").innerHTML = '<div class="backdrop" id="backdrop"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Opportunity detail">' +
      '<button class="close small" id="close">Close</button>' + itemTitle(i, true) +
      '<div class="meta">' + recChip(p) + "<span>" + esc(v.plain_status) + "</span></div>" +
      commercialHtml(p, oppState.rules) +
      '<h3>Where it stands</h3><dl class="kv">' +
      (v.why ? "<dt>Why it may fit</dt><dd>" + esc(v.why) + "</dd>" : "") +
      (p.next_action ? "" : "<dt>Next action</dt><dd>None</dd>") +
      "<dt>Owner</dt><dd>" + (p.owner ? ownerOf(p) : "None") + "</dd>" +
      "<dt>Deadline</dt><dd>" + esc(p.deadline_words ? p.deadline_what + ": " + p.deadline_words : "None due") + "</dd>" +
      (v.decision_overdue_since ? "<dt>Overdue</dt><dd>The research asked for your decision by " + esc(v.decision_overdue_since) + ".</dd>" : "") +
      (v.closes_words ? "<dt>Closes on SAM.gov</dt><dd>" + esc(v.closes_words) + "</dd>" : "") +
      (v.lane_due_words ? "<dt>Responses due</dt><dd>" + esc(v.lane_due_words) + "</dd>" : "") +
      (v.date_conflict ? "<dt>Dates disagree</dt><dd>" + esc(v.date_conflict) + "</dd>" : "") +
      (v.stage === "responded" && v.sent_words ? "<dt>Our response</dt><dd>Sent " + esc(v.sent_words) + ". Done.</dd>" : "") +
      (v.registration_note ? "<dt>Industry day registration</dt><dd>" + (v.registration_status === "not_verified" ? chip("Not verified", "Low") + " " : "") +
        esc(v.registration_note) + "</dd>" : "") +
      (v.waiting_on === "government" ? "<dt>Waiting on the government</dt><dd>" + (v.reassess ? chip("Reassess", "Medium") + " " + esc(v.reassess_why) : esc(v.waiting_why || "")) + "</dd>" : "") +
      // a response already sent is not shown with the record's "Responses due" line: the date it carries is in Deadline above
      (i.next_date_la && v.stage !== "responded" ? "<dt>Next date on record</dt><dd>" + esc(i.next_date_what + ": " + i.next_date_la) + "</dd>" : "") +
      "<dt>Figure on record</dt><dd>" + (i.value_text ? esc(i.value_text) + " (" + esc(v.value_words) + "). " + esc(v.value_note) : "Unknown: no figure is on record.") + "</dd>" +
      (know.length ? "<dt>What we know</dt><dd><ul>" + know.map(function (k) { return "<li>" + esc(k) + "</li>"; }).join("") + "</ul></dd>" : "") +
      (unk.length ? "<dt>Still uncertain</dt><dd><ul>" + unk.map(function (k) { return "<li>" + esc(k) + "</li>"; }).join("") + "</ul></dd>" : "") +
      (v.also_needed ? "<dt>Also needed</dt><dd>" + esc(v.also_needed) + "</dd>" : "") +
      (i.layer_decision ? "<dt>Your decision here</dt><dd>" + esc(DECISION[i.layer_decision.decision]) + " (" + esc(i.layer_decision.at_la) + ")" + (i.layer_decision.note ? ": " + esc(i.layer_decision.note) : "") + "</dd>" : "") +
      (v.tasks_open ? "<dt>Assistant tasks</dt><dd>" + plural(v.tasks_open, "open task") + ' <a href="va.html">in the queue</a></dd>' : "") +
      "<dt>Link</dt><dd>" + (link(i.link) || "None on record") + "</dd></dl>" +
      '<h3>Your decision</h3><div id="decide-box"></div>' +
      "<h3>Ratings</h3>" + ratingsLine(i) + evidenceHtml(i) + sourceText(i) + rule((v.rules || {}).stage, "How its standing is decided") + "</aside>";
    decisionBox($("#decide-box"), key);
    $("#close").addEventListener("click", closeItem);
    $("#backdrop").addEventListener("click", closeItem);
    document.addEventListener("keydown", escClose);
    $("#close").focus();
  }

  // ---------------------------------------------------------------- decisions that reach GovCon OS (file 0019)
  var GOVCON_STATE = { recorded: "Medium", research_open: "Info", waiting: "Info", error: "Low", refused: "Low", not_sent: "Muted" };
  function actionLine(d, withTitle) {
    return "<li><b>" + esc(DECISION[d.decision] || d.decision) + "</b> by " + esc(d.by) + " &middot; " + esc(d.at_la) +
      (withTitle ? '<div><a class="title" href="opportunities.html#' + encodeURIComponent(d.item_key) + '">' + esc(d.title || d.item_key) + "</a></div>" : "") +
      (d.note ? "<p>" + esc(d.note) + "</p>" : "") +
      ((d.paths || []).length ? '<p class="subtle">Paths asked for: ' + esc(d.paths.map(function (x) { return PATH_LABEL[x] || x; }).join("; ")) + "</p>" : "") +
      '<div class="meta">' + chip("GovCon OS", GOVCON_STATE[d.govcon_state] || "Muted") + " <span>" + esc(d.govcon) + "</span></div>" +
      (d.answer ? '<div class="answer"><b>Research answer</b> (' + esc(d.answered_by || "") + ", " + esc(d.answered_la || "") + ")<p>" + esc(d.answer) + "</p>" +
        (d.answer_sources ? '<p class="subtle">Sources: ' + esc(d.answer_sources) + "</p>" : "") + "</div>"
        : (d.govcon_state === "research_open" ? '<p class="subtle">The research run is working on it. The answer shows here when it is back.</p>' : "")) + "</li>";
  }
  var PATH_LABEL = { lane_check: "In our lane?", eligibility_check: "Set-aside and eligibility", incumbent_check: "Current holder and competition",
    value_check: "Contract value", date_check: "When the next solicitation posts", effort_check: "Work to respond", price_check: "Price and 15 percent profit",
    partner_check: "Prime or partner to team with", get_files: "Camille gets the files", ask_matt: "Ask Matt", other: "Something else" };
  // The decision box for one item: what was decided and what GovCon OS did with it, then the three buttons.
  function decisionBox(box, key, after) {
    box.innerHTML = '<p class="subtle">Loading...</p>';
    rpc("ci_item_actions", { p_item_key: key }).then(function (list) {
      box.innerHTML = ((list || []).length ? '<ul class="items compact">' + list.map(function (d) { return actionLine(d); }).join("") + "</ul>" : "") +
        '<div class="actions"><button data-act="go">Go</button><button data-act="no_go">No go</button><button data-act="research_next">Research next</button>' +
        '<details class="addnote"><summary>Add a note</summary><textarea maxlength="2000" rows="2" aria-label="Note (optional)"></textarea></details>' +
        '<span class="status" aria-live="polite"></span></div><div class="research"></div>' +
        '<p class="subtle">Go and No go are sent to GovCon OS, which every run follows. Research next asks for the checks you pick.</p>';
      all("[data-act]", box).forEach(function (b) {
        b.addEventListener("click", function () {
          var act = b.getAttribute("data-act"), st = $(".status", box), note = $(".addnote textarea", box).value;
          if (act === "research_next") { researchPanel($(".research", box), key, note, function () { decisionBox(box, key, after); if (after) after(); }); return; }
          all("button", box).forEach(function (x) { x.disabled = true; });
          st.textContent = "Saving...";
          rpc("ci_decide", { p_item_key: key, p_decision: act, p_note: note || null })
            .then(function () { decisionBox(box, key, after); if (after) after(); })
            .catch(function (e) { st.textContent = e.message; all("button", box).forEach(function (x) { x.disabled = false; }); });
        });
      });
    }).catch(function (e) { box.innerHTML = '<p class="notice">' + esc(e.message) + "</p>"; });
  }
  // Research next: the paths that fit this item, from what its record is missing. Pick one or more.
  function researchPanel(panel, key, note, done) {
    panel.innerHTML = '<p class="subtle">Loading the options...</p>';
    rpc("ci_research_options", { p_item_key: key }).then(function (r) {
      var opts = (r && r.options) || [];
      panel.innerHTML = '<fieldset class="paths"><legend>What should happen next so you can decide? Pick one or more.</legend>' +
        opts.map(function (o) {
          return '<label class="path"><input type="checkbox" value="' + esc(o.path) + '"> <b>' + esc(o.label) + "</b>" +
            '<span class="subtle"> ' + esc(o.why) + " Who: " + esc(o.who) + ".</span></label>";
        }).join("") + '<label class="note">Note (needed for "Ask Matt" and "Something else")<textarea maxlength="2000" rows="2">' + esc(note || "") + "</textarea></label>" +
        '<div class="actions"><button class="primary" data-send>Send the research request</button><button data-cancel>Cancel</button>' +
        '<span class="status" aria-live="polite"></span></div></fieldset>';
      $("[data-cancel]", panel).addEventListener("click", function () { panel.innerHTML = ""; });
      $("[data-send]", panel).addEventListener("click", function () {
        var paths = all("input[type=checkbox]", panel).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        var st = $(".status", panel);
        if (!paths.length) { st.textContent = "Pick at least one."; return; }
        all("button", panel).forEach(function (x) { x.disabled = true; });
        st.textContent = "Saving...";
        rpc("ci_research", { p_item_key: key, p_paths: paths, p_note: $("textarea", panel).value || null })
          .then(function () { panel.innerHTML = ""; done(); })
          .catch(function (e) { st.textContent = e.message; all("button", panel).forEach(function (x) { x.disabled = false; }); });
      });
    }).catch(function (e) { panel.innerHTML = '<p class="notice">' + esc(e.message) + "</p>"; });
  }

  // ---------------------------------------------------------------- 3. Decisions
  function decisions() {
    if (needsPhlux()) return;
    rpc("ci_decision_queue").then(function (q) {
      if (!q || !("set_aside_by_her_word" in q) || !("waiting_on_government_rule" in q) || q.pursuit_version !== "0010") { old0008(); return; }
      var w = q.waiting || [];
      var kind = function (k) { return w.filter(function (i) { return k.indexOf(i.view.decision_kind) >= 0; }); };
      var isReady = function (i) { var p = i.pursuit || {}; return p.recommendation === "pursue" || (p.recommendation === "investigate" && p.owner === "PHLUX"); };
      var strategic = kind(["go", "strategic"]), access = kind(["access", "system"]), research = kind(["likely_out", "research"]);
      var ready = strategic.filter(isReady), later = strategic.filter(function (i) { return !isReady(i); });
      var html = '<h1>Decisions</h1><p class="lede">Only what needs your judgment comes first, with the commercial view of each. Document and system problems are listed apart, ' +
        "and work for the assistant is on its own page. Go and No go are sent to GovCon OS, which every run follows; Research next asks for the checks you pick.</p>";
      html += '<h2 class="section">Decisions for you <span class="count">' + ready.length + "</span></h2>" +
        (ready.length ? '<div class="cards">' + ready.map(decisionCard).join("") + "</div>" : '<div class="panel empty">No decision is ready for you today.</div>');
      if (later.length) html += '<h2 class="section">Not ready for a decision <span class="count">' + later.length + "</span></h2>" +
        '<p class="lede">The commercial view says to investigate first, to watch, or to pass / deprioritize. You can still decide any of them.</p>' +
        '<div class="cards">' + later.map(decisionCard).join("") + "</div>" + rule(q.ready_rule);
      html += '<h2 class="section">Document access and system issues <span class="count">' + access.length + "</span></h2>" +
        '<p class="lede">Not decisions: each needs a step before the research can continue. Who resolves it is named.</p>' +
        (access.length ? '<div class="cards">' + access.map(function (i) { return blockCard(i); }).join("") + "</div>" : '<div class="panel empty">None.</div>');
      var waiting = q.waiting_on_government || [];
      html += '<h2 class="section">Waiting on the government <span class="count">' + waiting.length + "</span></h2>" +
        '<p class="lede">Ending contracts the research says to pursue. Not decisions: a reply or a new notice marks one for reassessment.</p>' +
        (waiting.length ? '<div class="cards">' + waiting.map(function (i) { return blockCard(i, "waiting"); }).join("") + "</div>" : '<div class="panel empty">None.</div>') +
        rule(q.waiting_on_government_rule);
      html += '<h2 class="section">Research needed before a decision <span class="count">' + research.length + "</span></h2>" +
        (research.length ? '<div class="cards">' + research.map(function (i) { return blockCard(i); }).join("") + "</div>" : '<div class="panel empty">None.</div>');
      var a = q.assistant || {}, bc = a.by_category || {};
      html += '<h2 class="section">Work for the assistant</h2><div class="panel"><p>' + plural(a.open || 0, "open task") +
        (Object.keys(bc).length ? ": " + CATEGORIES.filter(function (c) { return bc[c]; }).map(function (c) { return esc(bc[c]) + " " + esc(c.toLowerCase()); }).join(", ") : "") +
        '. <a href="va.html">Open the assistant queue</a></p></div>';
      var aside = q.set_aside_by_her_word || [];
      if (aside.length) html += '<h2 class="section">Set aside by your earlier word</h2><div class="panel"><ul class="items">' + aside.map(function (x) {
        return "<li><b>" + esc(x.title) + '</b> <span class="num">' + esc(x.number) + "</span><p>" + esc(x.plain_status) + "</p></li>";
      }).join("") + "</ul></div>";
      html += '<h2 class="section">Decided here</h2><div id="decided-here"><p class="subtle">Loading...</p></div>';
      setMain(html);
      rpc("ci_recent_actions").then(function (done) {
        $("#decided-here").innerHTML = (done || []).length ? '<div class="panel"><ul class="items">' + done.map(function (d) { return actionLine(d, true); }).join("") + "</ul></div>"
          : '<p class="empty">None yet.</p>';
      }).catch(function (e) { $("#decided-here").innerHTML = '<p class="notice">' + esc(e.message) + "</p>"; });
      all("[data-decide]").forEach(function (b) {
        b.addEventListener("click", function () {
          var card = b.closest(".card");
          var key = card.getAttribute("data-key");
          var note = $("textarea", card).value;
          var st = $(".status", card);
          if (b.getAttribute("data-decide") === "research_next") {
            var holder = $(".research", card);
            if (!holder) { holder = document.createElement("div"); holder.className = "research"; b.closest(".actions").after(holder); }
            researchPanel(holder, key, note, function () { decisions(); });
            return;
          }
          all("button", card).forEach(function (x) { x.disabled = true; });
          st.textContent = "Saving...";
          rpc("ci_decide", { p_item_key: key, p_decision: b.getAttribute("data-decide"), p_note: note || null })
            .then(function () { decisions(); })
            .catch(function (e) { st.textContent = e.message; all("button", card).forEach(function (x) { x.disabled = false; }); });
        });
      });
    }).catch(fail);
  }
  function decideButtons(primary) {
    var b = function (d, label) { return '<button data-decide="' + d + '"' + (d === primary ? ' class="primary"' : "") + ">" + esc(label) + "</button>"; };
    return '<div class="actions">' + b("go", "Go") + b("no_go", "No go") + b("research_next", "Research next") +
      '<details class="addnote"><summary>Add a note</summary><textarea maxlength="2000" rows="2" aria-label="Note (optional)"></textarea></details>' +
      '<span class="status" aria-live="polite"></span></div>';
  }
  function deadlineLine(v) {
    return v.deadline_words ? esc(v.deadline_what) + " " + esc(v.deadline_words) : "None on record";
  }
  // The commercial line on a Decisions card: the recommendation and, when someone else should check first, that check.
  function commercialLine(i) {
    var p = i.pursuit || {};
    if (!p.recommendation) return "";
    var first = p.recommendation === "investigate" && p.owner !== "PHLUX" && p.next_action
      ? " <b>Investigate first:</b> " + esc(p.next_action) + " " + esc(p.owner_note || ("Owner: " + ownerText(p.owner) + ".")) + " Decide after." : "";
    return "<dt>Commercial view</dt><dd>" + recChip(p) + " " + esc(p.reason) + first + "</dd>";
  }
  function decisionCard(i) {
    var v = i.view || {}, p = i.pursuit || {};
    var know = knownFacts(i), unk = uncertain(i);
    var why = v.decision_kind === "go" ? v.why
      : [v.decision_overdue_since ? "The research asked for your decision by " + v.decision_overdue_since + "." : "",
         v.closes_words && v.deadline_what === "Offers due" ? "Offers are due " + v.deadline_words + "." : "",
         v.lane_due_words ? "Responses are due " + v.lane_due_words + "." : "",
         !v.decision_overdue_since && !v.lane_due_words && v.deadline_what !== "Offers due" ? "The research needs your answer to continue." : ""].join(" ").trim();
    return '<article class="card" data-key="' + esc(i.item_key) + '"><div class="card-head"><div>' + itemTitle(i) + '</div><div class="due">' + esc(deadlineShort(v) || "") + "</div></div>" +
      '<dl class="kv tight">' + commercialLine(i) +
      "<dt>Why the research asks you</dt><dd>" + esc(why || v.plain_status) + "</dd>" +
      "<dt>Business upside</dt><dd>" + esc(p.upside || (i.value_text ? i.value_text + " (" + (v.value_words || "").toLowerCase() + ")" : "Not known: no figure is on record")) + ".</dd>" +
      "<dt>What we know</dt><dd>" + (know.length ? esc(clip(know.join(" "), 230)) : (v.blocker ? esc(clip(firstSentence(v.blocker), 230)) : "Nothing is settled yet.")) + "</dd>" +
      "<dt>Still uncertain</dt><dd>" + (unk.length ? esc(clip(unk.join("; "), 200)) : "Nothing listed.") + "</dd>" +
      "<dt>Decision needed</dt><dd><b>" + esc(v.decision_question || v.next_action) + "</b>" + (v.also_needed ? " " + esc(v.also_needed) : "") + "</dd>" +
      "<dt>Deadline</dt><dd>" + deadlineLine(v) + "</dd></dl>" +
      decideButtons(null) +
      '<details class="evidence"><summary>Details</summary>' + (v.next_action && v.decision_kind === "go" ? "<p><b>Next step on record:</b> " + esc(v.next_action) + "</p>" : "") +
      ratingsLine(i) + evidenceHtml(i) + sourceText(i) + (link(i.link) ? "<p>" + link(i.link) + "</p>" : "") + "</details></article>";
  }
  function blockCard(i, as) {
    var v = i.view || {};
    var g = i.government || {};
    var label = as === "waiting" ? (g.reassess ? "Reassess" : "Waiting on the government")
      : { access: "Document access", system: "System issue", likely_out: "Probably out", research: "Research needed" }[v.decision_kind] || "";
    return '<article class="card" data-key="' + esc(i.item_key) + '"><div class="card-head"><div>' + itemTitle(i) + '</div><div class="due">' +
      chip(label, v.decision_kind === "likely_out" ? "Muted" : as === "waiting" ? (g.reassess ? "Medium" : "Info") : "Medium") + "</div></div>" +
      '<dl class="kv tight">' + commercialLine(i) +
      "<dt>" + (as === "waiting" ? "Where it stands" : "What is blocked") + "</dt><dd>" + esc(v.plain_status) + "</dd>" +
      (as === "waiting" ? "<dt>Inquiry</dt><dd>" + esc(g.inquiry || "None on record") + "</dd>" +
        "<dt>Follow up</dt><dd>" + esc(g.follow_up_la || "No date on record") + "</dd>" +
        "<dt>Reply</dt><dd>" + esc(g.reply_status || "") + "</dd>" +
        "<dt>New notice</dt><dd>" + esc(g.new_notice || "") + "</dd>" +
        (v.decision_kind ? "<dt>Also on Decisions for you</dt><dd>" + esc(v.decision_question || "") + "</dd>" : "") : "") +
      "<dt>" + (as === "waiting" ? "Who watches for it" : "Who resolves it") + "</dt><dd>" + esc(ownerText(v.owner)) +
      (v.names_phlux && v.decision_kind === "access" ? " (the record says a Body Ops sign-in is needed)" : "") + "</dd>" +
      "<dt>Next step</dt><dd>" + esc(v.next_action || "") + "</dd>" +
      (as === "waiting" ? "" : "<dt>By when</dt><dd>" + deadlineLine(v) + "</dd>") +
      "<dt>Figure on record</dt><dd>" + (i.value_text ? esc(i.value_text) + " (" + esc((v.value_words || "").toLowerCase()) + ")" : "Unknown") + "</dd></dl>" +
      '<details class="evidence"><summary>Details and your decision</summary>' + (v.blocker ? "<p>" + esc(v.blocker) + "</p>" : "") +
      (v.next_step_on_record ? "<p><b>The research's next step on record:</b> " + esc(v.next_step_on_record) + "</p>" : "") +
      ratingsLine(i) + evidenceHtml(i) + sourceText(i) + (link(i.link) ? "<p>" + link(i.link) + "</p>" : "") +
      "<p class=\"subtle\">You can still record a decision on it here.</p>" + decideButtons(v.decision_kind === "likely_out" ? "no_go" : null) + "</details></article>";
  }

  // ---------------------------------------------------------------- 4. Assistant queue
  var vaState = { tasks: [], open: {} };
  function assistant() {
    rpc("ci_va_queue").then(function (tasks) {
      if (tasks && tasks.length && !("category" in tasks[0])) { old0008(); return; }
      vaState.tasks = tasks || [];
      var phlux = isPhlux();
      var open = vaState.tasks.filter(function (t) { return ["open", "in_progress", "blocked"].indexOf(t.status) >= 0; });
      var closed = vaState.tasks.filter(function (t) { return t.status === "done" || t.status === "dropped"; });
      // one row per step: the same step listed for several records of a notice is shown once
      var groups = [], byKey = {};
      open.forEach(function (t) {
        var g = byKey[t.group_key];
        if (!g) { g = byKey[t.group_key] = { key: t.group_key, tasks: [], first: t }; groups.push(g); }
        g.tasks.push(t);
      });
      var flagged = groups.filter(function (g) { return (g.first.flags || []).length; });
      var html = "<h1>Assistant queue</h1><p class='lede'>" + (phlux ? "Every task, by group of work. " : "Your tasks. ") +
        "Select a row for the instructions, the evidence and when it is done. Updates are saved in this layer only; nothing is sent to anyone.</p>";
      if (phlux) {
        var seat = open.length && open.every(function (t) { return t.owner_email === me.email; }) && (me.seats || []).indexOf("va") >= 0;
        html += '<div class="panel attention"><h2>Needs your attention</h2><ul class="plain">' +
          (seat ? "<li>The assistant seat is held by your own sign-in for now, so these tasks sit with you. Adding the assistant's own email is a seat change and needs your approval.</li>" : "") +
          "<li>" + plural(flagged.length, "row has", "rows have") + " a note to review (marked below). Nothing is dropped or reassigned without you.</li>" +
          "<li>" + plural(open.filter(function (t) { return !t.owner_email; }).length, "task has", "tasks have") + " no owner; " +
          plural(open.filter(function (t) { return t.due_at && Date.parse(t.due_at) < Date.now(); }).length, "task is", "tasks are") + " overdue.</li></ul></div>";
      }
      var counts = '<p class="counts">' + open.filter(function (t) { return t.status === "open"; }).length + " open &middot; " +
        open.filter(function (t) { return t.status === "in_progress"; }).length + " in progress &middot; " +
        open.filter(function (t) { return t.status === "blocked"; }).length + " blocked</p>";
      html += counts;
      if (groups.length) {
        html += '<div class="table-wrap"><table class="va rtable"><thead><tr><th scope="col">Task</th><th scope="col">Related opportunity</th>' +
          '<th scope="col">Priority</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead><tbody>';
        CATEGORIES.forEach(function (c) {
          var gs = groups.filter(function (g) { return g.first.category === c; });
          if (!gs.length) return;
          html += '<tr class="static cat"><th colspan="6" scope="rowgroup">' + esc(c) + ' <span class="count">' + gs.length + "</span></th></tr>";
          gs.forEach(function (g) { html += taskRow(g, phlux); });
        });
        html += "</tbody></table></div>";
      } else html += '<div class="panel empty">No open task.</div>';
      if (phlux) {
        html += '<details class="panel add"><summary>Add a task</summary><form id="addtask"><label class="note">What to do<textarea id="nt-task" required maxlength="1000" rows="2"></textarea></label>' +
          '<label class="note">It is done when<textarea id="nt-done" required maxlength="1000" rows="2"></textarea></label>' +
          '<div class="filters"><label>Priority<select id="nt-pri"><option value="1">1 (first)</option><option value="2" selected>2</option><option value="3">3</option></select></label>' +
          '<label>Due (this computer\'s time)<input type="datetime-local" id="nt-due"></label><button class="primary" type="submit">Add the task</button><span class="status" id="nt-status" aria-live="polite"></span></div></form></details>';
      }
      html += '<h2 class="section">Done or dropped</h2>' + (closed.length ? '<details class="panel"><summary>' + plural(closed.length, "task") + "</summary><ul class=\"items\">" + closed.map(function (t) {
        return "<li>" + esc(t.short || t.task) + '<div class="meta">' + esc(STATUS[t.status]) + (t.va_note ? " &middot; " + esc(t.va_note) : "") + "</div></li>";
      }).join("") + "</ul></details>" : '<p class="empty">None yet.</p>');
      setMain(html);
      all("tr.task").forEach(function (tr) {
        var toggle = function () {
          var k = tr.getAttribute("data-group");
          var det = $('tr.detail[data-group="' + k + '"]');
          var shown = !det.classList.contains("hidden");
          det.classList.toggle("hidden", shown);
          tr.setAttribute("aria-expanded", String(!shown));
          vaState.open[k] = !shown;
        };
        tr.addEventListener("click", toggle);
        tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      });
      all("[data-status]").forEach(function (b) {
        b.addEventListener("click", function () {
          var box = b.closest(".task-detail");
          var ids = box.getAttribute("data-ids").split(",");
          var st = $(".status", box);
          var note = $("textarea", box).value || null;
          all("button", box).forEach(function (x) { x.disabled = true; });
          st.textContent = "Saving...";
          ids.reduce(function (p, id) {
            return p.then(function () { return rpc("ci_task_update", { p_task: id, p_status: b.getAttribute("data-status"), p_note: note }); });
          }, Promise.resolve()).then(function () { assistant(); })
            .catch(function (e) { st.textContent = e.message; all("button", box).forEach(function (x) { x.disabled = false; }); });
        });
      });
      var f = $("#addtask");
      if (f) f.addEventListener("submit", function (e) {
        e.preventDefault();
        var due = $("#nt-due").value;
        $("#addtask button[type=submit]").disabled = true;
        rpc("ci_task_add", { p_task: $("#nt-task").value, p_done_when: $("#nt-done").value, p_priority: Number($("#nt-pri").value),
          p_due: due ? new Date(due).toISOString() : null }).then(function () { assistant(); })
          .catch(function (err) { $("#nt-status").textContent = err.message; $("#addtask button[type=submit]").disabled = false; });
      });
    }).catch(fail);
  }
  function taskRow(g, phlux) {
    var t = g.first, n = g.tasks.length, k = g.key;
    var flags = t.flags || [];
    var btn = function (s, label) { return t.status === s ? "" : '<button data-status="' + s + '"' + (s === "done" ? ' class="primary"' : "") + ">" + esc(label) + "</button>"; };
    var shown = !!vaState.open[k];
    return '<tr class="task" data-group="' + esc(k) + '" tabindex="0" aria-expanded="' + shown + '">' +
      '<td class="item" data-label="Task"><b>' + esc(t.short || t.task) + "</b>" + (n > 1 ? " " + chip("×" + n, "Info") : "") + (flags.length ? " " + chip("Review", "Medium") : "") + "</td>" +
      '<td data-label="Related opportunity">' + esc(clip(t.related_title || t.item_title || "", 80)) + (t.solicitation_number ? '<div class="num">' + esc(t.solicitation_number) + "</div>" : "") +
      (t.related_worth ? '<div class="subtle">' + esc(t.related_worth) + "</div>" : "") + "</td>" +
      '<td data-label="Priority">' + esc(t.priority) + "</td>" +
      '<td data-label="Owner">' + esc(t.owner_label || t.owner_email || "Not assigned") + "</td>" +
      '<td data-label="Due">' + (t.due_at ? esc(shortDate(t.due_at)) : '<span class="subtle">No due date</span>') + "</td>" +
      '<td data-label="Status">' + chip(STATUS[t.status] || t.status, t.status === "blocked" ? "Low" : t.status === "in_progress" ? "Medium" : "Info") + "</td></tr>" +
      '<tr class="static detail' + (shown ? "" : " hidden") + '" data-group="' + esc(k) + '"><td colspan="6"><div class="task-detail" data-ids="' + esc(g.tasks.map(function (x) { return x.id; }).join(",")) + '">' +
      (flags.length ? '<ul class="flags">' + flags.map(function (f) { return "<li>" + esc(f.text) + "</li>"; }).join("") + "</ul>" : "") +
      '<dl class="kv"><dt>Instructions</dt><dd>' + esc(t.task) + "</dd><dt>Done when</dt><dd>" + esc(t.done_when) + "</dd>" +
      "<dt>Evidence</dt><dd>" + esc(t.evidence || "None recorded") + "</dd>" +
      (t.link ? "<dt>Link</dt><dd>" + link(t.link, "Open the source") + "</dd>" : "") +
      (n > 1 ? "<dt>Covers</dt><dd>" + plural(n, "task") + " for the same step; the buttons update all of them.</dd>" : "") +
      (t.va_note ? "<dt>Note</dt><dd>" + esc(t.va_note) + "</dd>" : "") +
      ((t.events || []).length ? "<dt>History</dt><dd>" + t.events.map(function (e) { return esc(e.at_la) + ": " + esc(STATUS[e.to] || e.to) + (e.note ? " (" + esc(e.note) + ")" : ""); }).join("<br>") + "</dd>" : "") +
      "</dl>" + '<label class="note">Note (optional)<textarea maxlength="2000" rows="2"></textarea></label><div class="actions">' +
      btn("in_progress", "Start") + btn("blocked", "Blocked") + btn("done", "Done") + (phlux ? btn("dropped", "Drop") : "") + '<span class="status" aria-live="polite"></span></div></div></td></tr>';
  }

  // ---------------------------------------------------------------- 5. Pipeline
  function pipeline() {
    if (needsPhlux()) return;
    rpc("ci_pipeline").then(function (p) {
      if (!p || !p.stages || !(p.stages[1] && "waiting_on_government" in p.stages[1])) { old0008(); return; }
      var stages = p.stages || [];
      var html = '<h1>Pipeline</h1><p class="lede">Five stages, from first look to award. Figures appear only where they are on record, each with its kind, ' +
        "and are never added together. Market research, industry days, vehicles and subcontract routes are kept apart.</p>";
      html += '<div class="stages">' + stages.map(function (s, n) {
        return '<a class="stage" href="#st-' + esc(s.key) + '"><span class="stage-n">' + (n + 1) + "</span><b>" + esc(s.count == null ? "Not recorded" : num(s.count)) + "</b><span>" + esc(s.label) + "</span></a>";
      }).join("") + "</div>";
      var table = function (rows, cols) {
        return rows.length ? '<div class="table-wrap"><table class="rtable"><thead><tr>' + cols.map(function (c) { return '<th scope="col">' + esc(c[0]) + "</th>"; }).join("") +
          "</tr></thead><tbody>" + rows.map(function (r) {
            return '<tr class="static">' + cols.map(function (c) { return '<td data-label="' + esc(c[0]) + '">' + c[1](r) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>" : '<p class="empty">None.</p>';
      };
      var oppCols = [["Opportunity", function (x) { return '<a class="title" href="opportunities.html#' + encodeURIComponent(x.item_key) + '">' + esc(x.title) + '</a><div class="num">' + esc(x.number) + " &middot; " + esc(typeText(x.type)) + "</div>"; }],
        ["Figure on record", function (x) { return valueBlock(x.value, x.value_words); }],
        ["Where it stands", function (x) { return esc(clip(x.plain_status, 110)); }],
        ["Next step", function (x) { return esc(clip(x.next_action, 120)); }],
        ["Deadline", function (x) { return x.deadline_words ? esc(x.deadline_what + " " + x.deadline_words) : '<span class="subtle">None</span>'; }]];
      var s1 = stages[0] || {}, s2 = stages[1] || {}, s3 = stages[2] || {}, s4 = stages[3] || {}, s5 = stages[4] || {};
      var first = (s1.items || []).filter(function (x) { return x.promising; }), rest = (s1.items || []).filter(function (x) { return !x.promising; });
      html += '<section class="panel" id="st-potential"><h2>1. ' + esc(s1.label) + ' <span class="count">' + esc(num(s1.count)) + "</span></h2><p class=\"lede\">" +
        esc(num(s1.priced_bids)) + " priced bids and " + esc(num(s1.contracts_ending)) + " contracts ending whose next contract would be a priced bid. " +
        esc(num(s1.promising)) + " look promising on the fit points.</p><h3>Promising</h3>" + table(first, oppCols) +
        '<details class="evidence"><summary>The other ' + esc(rest.length) + "</summary>" + table(rest, oppCols) + "</details></section>";
      html += '<section class="panel" id="st-qualified"><h2>2. ' + esc(s2.label) + ' <span class="count">' + esc(num(s2.count)) + "</span></h2>" +
        (s2.waiting_on_government ? '<p class="lede">' + plural(num(s2.waiting_on_government), "of them waits", "of them wait") +
          ' on the government: not decisions. <a href="decisions.html">See them on the Decisions page</a></p>' : "") +
        table(s2.items || [], [oppCols[0], oppCols[1], ["Your go", function (x) { return esc(x.worth) + (x.waiting_on === "government" ? '<div class="subtle">Waiting on the government</div>' : ""); }], oppCols[3], oppCols[4]]) + "</section>";
      html += '<section class="panel" id="st-preparing"><h2>3. ' + esc(s3.label) + ' <span class="count">' + esc(num(s3.count)) + "</span></h2><p>" + esc(s3.note) + "</p></section>";
      html += '<section class="panel" id="st-submitted"><h2>4. ' + esc(s4.label) + ' <span class="count">' + esc(num(s4.count)) + "</span></h2><p class=\"lede\">" + esc(s4.note) + "</p>" +
        table(s4.items || [], [["Bid", function (x) { return "<b>" + esc(x.title || "") + '</b><div class="num">' + esc(x.number) + "</div>"; }],
          ["Sent", function (x) { return esc(x.sent_words) + (x.sends > 1 ? '<div class="subtle">sent or added to ' + esc(x.sends) + " times; counted once</div>" : ""); }],
          ["Our price", function (x) { return x.our_price ? '<span class="money">' + esc(x.our_price) + "</span>" : '<span class="subtle">Not on record</span>'; }],
          ["Receipt on record", function (x) { return x.receipt ? "Yes" : "No"; }]]) +
        ((s4.with_problem || []).length ? "<h3>Sent, with a problem on record (not counted above)</h3>" + table(s4.with_problem, [
          ["Bid", function (x) { return "<b>" + esc(x.title || "") + '</b><div class="num">' + esc(x.number) + "</div>"; }],
          ["Sent", function (x) { return esc(x.sent_words); }],
          ["Our price", function (x) { return x.our_price ? '<span class="money">' + esc(x.our_price) + "</span>" : '<span class="subtle">Not on record</span>'; }],
          ["On record", function (x) { return esc(x.problem); }]]) : "") + "</section>";
      html += '<section class="panel" id="st-awarded"><h2>5. ' + esc(s5.label) + ' <span class="count">' + esc(num(s5.count)) + "</span></h2><p>" + esc(s5.note) + "</p></section>";

      var o = p.other_routes || {}, mr = o.market_research || {};
      var mini = function (arr, extra) {
        return arr && arr.length ? '<ul class="items">' + arr.map(function (x) {
          return '<li><a class="title" href="opportunities.html#' + encodeURIComponent(x.item_key) + '">' + esc(x.title) + '</a><div class="num">' + esc(x.number) + "</div>" +
            '<div class="meta">' + chip(x.worth, worthClass(x.worth && x.worth.indexOf("Yes") === 0 ? "qualified" : x.worth && x.worth.indexOf("Maybe") === 0 ? "research" : x.worth === "Responded" ? "responded" : "passed")) +
            (x.deadline_words ? "<span>" + esc(x.deadline_what + " " + x.deadline_words) + "</span>" : "") + "</div>" + (extra ? extra(x) : "") + "</li>";
        }).join("") + "</ul>" : '<p class="empty">None.</p>';
      };
      html += '<h2 class="section">Kept apart from priced bids</h2><div class="grid">';
      html += '<section class="panel"><h2>Market research</h2><p>' + plural(num(mr.responses_sent), "response", "responses") + " sent with no price, counted once per notice" +
        ((mr.by_month || []).length ? ": " + mr.by_month.map(function (m) { return esc(monthLabel(m.month)) + " " + esc(m.responses); }).join(", ") : "") + ".</p><h3>Open now</h3>" + mini(mr.open) + "</section>";
      html += '<section class="panel"><h2>Industry days</h2>' + mini(o.industry_days, function (x) {
        return (x.registration_status === "not_verified" ? '<div class="meta">' + chip("Registration not verified", "Low") + "</div><p>" + esc(x.next_action || "") + "</p>" : "") +
          (x.registration_note ? '<p class="subtle">' + esc(x.registration_note) + "</p>" : "");
      }) + "</section>";
      html += '<section class="panel"><h2>Contract vehicles</h2><p class="subtle">Winning a place on a vehicle gives the right to compete for later orders, not revenue.</p>' + mini(o.vehicles) + "</section>";
      html += '<section class="panel"><h2>Subcontract routes</h2><p class="subtle">No route is recorded as a subcontract yet. Listed: decisions that include approaching a prime about a subcontract.</p>' + mini(o.subcontract_routes) + "</section>";
      html += "</div>";
      html += '<section class="panel wide"><h2>What the figures mean</h2><dl class="kv">' + (p.value_kinds || []).map(function (k) {
        return "<dt>" + esc(k.kind) + "</dt><dd>" + esc(k.text) + "</dd>";
      }).join("") + "</dl></section>";
      var gp = p.gross_profit || {};
      html += '<details class="panel ops"><summary>More detail</summary><div class="grid"><div><h3>Responses by month (counted once per notice)</h3><ul class="plain">' +
        (p.responses_by_month || []).map(function (m) { return "<li>" + esc(monthLabel(m.month)) + ": " + plural(m.responses, "response") + ", " + plural(m.priced_offers, "priced offer") + "</li>"; }).join("") +
        "</ul></div><div><h3>Estimated gross profit</h3><p>" + tag(gp.label || "Unknown") + " " + esc(gp.text || (gp.total + " across " + gp.bids + " bid" + (gp.bids === 1 ? "" : "s") + "; " + gp.formula)) + "</p>" +
        "<h3>Awards and realized revenue</h3><p>Awards: " + esc(p.awards) + "</p><p>Realized revenue: " + esc(p.realized_revenue) + "</p></div></div></details>";
      setMain(html);
    }).catch(fail);
  }

  // ---------------------------------------------------------------- start
  function start() {
    client.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (!session) { showSignIn(); return; }
      return rpc("ci_me").then(function (m) {
        me = m;
        header();
        if (!me.seats || !me.seats.length) {
          setMain('<div class="panel"><h2>No seat for this email address</h2><p>' + esc(me.email) + " is signed in but holds no seat in Capture Intelligence, so nothing is shown.</p></div>");
          return;
        }
        ({ briefing: briefing, opportunities: opportunities, decisions: decisions, assistant: assistant, pipeline: pipeline }[page] || briefing)();
      });
    }).catch(fail);
  }

  if (!cfg.url || !cfg.key || !window.supabase) {
    setMain('<div class="panel"><h2>Not set up yet</h2><p>The screens are not connected to the Capture Intelligence project yet.</p></div>');
    return;
  }
  client = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { flowType: "implicit", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
  });
  var current = document.querySelector('nav a[data-page="' + page + '"]');
  if (current) current.setAttribute("aria-current", "page");
  start();
})();
