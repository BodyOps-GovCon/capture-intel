/* Capture Intelligence screens. Reads only the sidecar project; every change is saved only there. */
(function () {
  "use strict";
  var cfg = window.CI_CONFIG || {};
  var page = document.body.getAttribute("data-page");
  var client = null;
  var me = null;

  var TYPE = { priced_bid: "Priced bid", market_research: "Market research", future_bid: "Future bid",
    contract_vehicle: "Contract vehicle", subcontract_route: "Subcontract route", contract_ending: "Contract ending", unknown: "Type unknown" };
  var KIND = { federal_notice: "Federal notice", state_local_lead: "State or local lead", contract_ending: "Contract ending" };
  var DECISION = { go: "Go", no_go: "No go", research_next: "Research next" };
  var FACTOR = { type: "Type", value: "Value", relevance: "Relevance", eligibility: "Eligibility", competition: "Competition",
    effort: "Effort", urgency: "Urgency", attractiveness: "Attractiveness", decision: "Suggested decision", action: "Action" };
  var RANK = { High: 0, Medium: 1, Low: 2, Unknown: 3 };
  var URG = { "Today": 0, "This week": 1, "Later": 2, "No date": 3, "Past": 4 };
  var EFFORT_RANK = { Low: 0, Medium: 1, High: 2, Unknown: 3 };
  var STATUS = { open: "Open", in_progress: "In progress", blocked: "Blocked", done: "Done", dropped: "Dropped" };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function $(sel, el) { return (el || document).querySelector(sel); }
  function all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) {
    return s == null ? "" : String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function chip(text, cls) { return '<span class="chip ' + esc(cls || text) + '">' + esc(text) + "</span>"; }
  function urgChip(u) { return chip(u, u === "This week" ? "ThisWeek" : u === "No date" ? "NoDate" : u); }
  function tag(label) { return '<span class="tag ' + esc(label) + '">' + esc(label) + "</span>"; }
  function plural(n, one, many) { return esc(n) + " " + (Number(n) === 1 ? one : (many || one + "s")); }
  function num(n) { return n == null ? "0" : Number(n).toLocaleString("en-US"); }
  function link(url, text) {
    if (!url || !/^https?:\/\//i.test(url)) return "";
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(text || "Open the notice") + "</a>";
  }
  function monthLabel(m) {
    var x = /^(\d{4})-(\d{2})$/.exec(m || "");
    return x ? MONTHS[Number(x[2]) - 1] + " " + x[1] : (m || "");
  }
  // "Mon 2 Nov, 11:59 PM" in Los Angeles time; the date alone when no time of day is on record.
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
  function noTimeOnRecord(i) {
    return (i.evidence || []).some(function (e) { return e.factor === "urgency" && /no time of day on record/.test(e.statement || ""); });
  }
  function setMain(html) { $("#main").innerHTML = html; }
  function fail(err) {
    setMain('<div class="panel"><h2>Something went wrong</h2><p>' + esc(err && (err.message || err.error_description || err)) +
      "</p><p>Reload the page. If it happens again, tell Claude what this box says.</p></div>");
  }
  function rpc(name, args) {
    return client.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
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
    if ((me.seats || []).indexOf("phlux") >= 0) return false;
    setMain('<div class="panel"><h2>This screen is for the PHLUX seat</h2><p>Your seat shows the <a href="va.html">virtual assistant queue</a>.</p></div>');
    return true;
  }

  // ---------------------------------------------------------------- shared pieces
  function evidenceHtml(item, open) {
    var rows = (item.evidence || []).map(function (e) {
      return '<div class="row"><div class="head"><b>' + esc(FACTOR[e.factor] || e.factor) + "</b>" + tag(e.label) + "</div>" +
        "<p>" + esc(e.statement) + "</p>" +
        (e.quote ? "<blockquote>" + esc(e.quote) + "</blockquote>" : "") +
        (e.source ? '<div class="src">Source: ' + esc(e.source) + "</div>" : "") +
        (e.rule ? '<div class="rule">' + esc(e.rule) + "</div>" : "") + "</div>";
    }).join("");
    return '<details class="evidence"' + (open ? " open" : "") + '><summary>Evidence for every rating</summary><div class="ev">' + rows + "</div></details>";
  }
  function ratingsLine(i) {
    return '<div class="meta">' + chip("Attractiveness: " + i.attractiveness, i.attractiveness) +
      urgChip(i.urgency) + chip("Value: " + i.value_rating, i.value_rating) + chip("Relevance: " + i.relevance_rating, i.relevance_rating) +
      chip("Eligibility: " + i.eligibility_rating, i.eligibility_rating) + chip("Competition: " + i.competition_rating, i.competition_rating) +
      chip("Effort: " + i.effort_rating, "effort " + i.effort_rating) + "</div>";
  }
  function kindAndType(i) {
    var k = KIND[i.item_kind] || i.item_kind, t = TYPE[i.opportunity_type] || i.opportunity_type;
    return k === t ? esc(k) : esc(k) + " &middot; " + esc(t);
  }
  function itemHead(i) {
    return '<div class="num">' + esc(i.solicitation_number || "") + " &middot; " + kindAndType(i) +
      '</div><div class="title">' + esc(i.title || "(no title on record)") + "</div>" +
      '<div class="meta">' + esc(i.buyer || "") + (i.place ? " &middot; " + esc(i.place) : "") + "</div>";
  }
  function legend() {
    return '<div class="legend"><span>' + tag("Fact") + " from a GovCon OS record, with its source</span><span>" + tag("Derived") +
      " arithmetic on facts, formula shown</span><span>" + tag("Assessment") + " a written rule, rule shown</span><span>" + tag("Unknown") +
      " not on record</span><span>No probability of winning is shown anywhere.</span></div>";
  }

  // ---------------------------------------------------------------- 1. Daily Capture Briefing
  function briefing() {
    if (needsPhlux()) return;
    rpc("ci_briefing").then(function (b) {
      if (!b) { setMain('<div class="panel">No briefing yet. It is built when a copy is loaded.</div>'); return; }
      var c = b.counts || {};
      var list = function (arr, f, none) {
        return arr && arr.length ? '<ul class="items">' + arr.map(function (x) { return "<li>" + f(x) + "</li>"; }).join("") + "</ul>"
          : '<p class="empty">' + esc(none) + "</p>";
      };
      var stat = function (n, label) { return '<div class="stat"><b>' + esc(n == null ? "Not counted" : num(n)) + "</b><span>" + esc(label) + "</span></div>"; };
      var html = "<h1>Daily capture briefing</h1><p class='lede'>Built " + esc(b.built_at_la) + " from the copy shown above. " +
        "Decisions and tasks below come from GovCon OS records and the written rules. Open any item on the Opportunities screen for its evidence.</p>" +
        '<div class="panel wide"><div class="stats">' +
        stat(b.decisions_waiting, "decisions waiting for PHLUX") + stat(b.va_open_tasks, "open assistant tasks") +
        stat(c.priced_bids_open, "open priced bids") + stat(c.market_research, "market research notices") +
        stat(c.vehicles, "contract vehicles") + stat(c.contracts_ending, "contracts ending, on watch") +
        stat(c.state_local, "state and local leads") + stat(c.screened_out_open, "open federal notices the daily screen ruled out") +
        "</div></div>";
      html += '<div class="grid">';
      html += '<section class="panel"><h2>Top decisions for PHLUX</h2>' + list(b.top_decisions, function (d) {
        return '<div class="num">' + esc(d.number) + " &middot; " + esc(TYPE[d.type] || d.type) + '</div><div class="title">' + esc(d.title) + "</div>" +
          '<div class="meta">' + urgChip(d.urgency) + (d.next_date ? "<span>" + esc(d.next_date_what) + ": " + esc(d.next_date) + "</span>" : "") + "</div>" +
          "<p>" + esc(d.why) + "</p><p><b>Action:</b> " + esc(d.action) + "</p>" +
          '<div class="meta">' + tag("Assessment") + "<span>Rule's suggestion: " + esc(DECISION[d.suggested] || d.suggested) + "</span></div>";
      }, "No decision is waiting.") + '<p><a href="decisions.html">All decisions waiting (' + esc(b.decisions_waiting) + ")</a></p></section>";
      html += '<section class="panel"><h2>Top tasks for the virtual assistant</h2>' + list(b.va_top_tasks, function (t) {
        return '<div class="meta">' + chip("Priority " + t.priority, t.priority === 1 ? "Low" : "Unknown") + "<span>" + (t.due ? "Due " + esc(t.due) : "No due date") + "</span></div><p>" + esc(t.task) + "</p>";
      }, "No open task.") + '<p><a href="va.html">The whole queue (' + esc(b.va_open_tasks) + " open)</a></p></section>";
      html += '<section class="panel"><h2>Deadlines in the next 14 days</h2>' + list(b.deadlines_14_days, function (d) {
        return '<div class="meta">' + urgChip(d.urgency) + "<b>" + esc(d.when) + "</b></div>" + '<div class="num">' + esc(d.number) + " &middot; " + esc(TYPE[d.type] || d.type) +
          "</div><div>" + esc(d.what) + ": " + esc(d.title) + '</div><div class="meta">' + esc(d.status) + "</div>";
      }, "No deadline in the next 14 days.") + "</section>";
      html += '<section class="panel"><h2>Open priced bids</h2><p class="lede">Priced bids whose dates have not all passed and that are not ruled out, ' +
        "highest attractiveness and largest figure first. A figure is shown only where one is on record.</p>" +
        list(b.best_priced_bids, function (p) {
          return '<div class="num">' + esc(p.number) + '</div><div class="title">' + esc(p.title) + '</div><div class="meta">' + chip("Attractiveness: " + p.attractiveness, p.attractiveness) +
            urgChip(p.urgency) + "</div>" + '<div class="meta">' + (p.value ? tag("Fact") + "<span>" + esc(p.value) + " (" + esc(p.value_kind) + ")</span>" : tag("Unknown") + "<span>no figure on record</span>") + "</div>" +
            '<div class="meta">' + esc(p.status) + (p.next_date ? " &middot; next date " + esc(p.next_date) : "") + "</div>";
        }, "No open priced bid.") + '<p><a href="pipeline.html">Revenue pipeline</a></p></section>';
      html += '<section class="panel"><h2>Blocked</h2>' + list(b.blocked, function (x) {
        return '<div class="num">' + esc(x.number) + '</div><div class="title">' + esc(x.title) + "</div><p>" + esc(x.blocked_on) + "</p>";
      }, "Nothing blocked.") + "</section>";
      var o = b.other_routes || {};
      var mini = function (arr) {
        return arr && arr.length ? "<ul class='items'>" + arr.map(function (x) {
          return "<li><span class='num'>" + esc(x.number) + "</span><div>" + esc(x.title) + "</div><div class='meta'>" + esc(x.status || "") + (x.when ? " &middot; " + esc(x.when) : "") + "</div></li>";
        }).join("") + "</ul>" : "<p class='empty'>None.</p>";
      };
      html += '<section class="panel"><h2>Kept apart from priced bids</h2><h3>Market research</h3>' + mini(o.market_research) +
        "<h3>Contract vehicles</h3>" + mini(o.vehicles) + "<h3>Subcontract routes</h3>" + mini(o.subcontract_routes) +
        "<h3>Contracts ending that the research says to pursue</h3>" + mini(o.contracts_ending_pursue) + "</section>";
      var p = b.pipeline || {};
      html += '<section class="panel"><h2>Priced offers sent</h2>' +
        ((p.priced_offers_by_month || []).length ? "<ul class='items'>" + p.priced_offers_by_month.map(function (m) {
          return "<li>" + esc(monthLabel(m.month)) + ": " + plural(m.offers, "priced offer") + ", " + esc(m.total) + " in all</li>";
        }).join("") + "</ul>" : "<p class='empty'>None on record.</p>") + "<p>Awards: " + esc(p.awards) + '.</p><p><a href="pipeline.html">Revenue pipeline</a></p></section>';
      var q = b.data_quality || {};
      html += '<section class="panel"><h2>Data quality</h2><ul class="items">' +
        "<li>" + plural(q.rulings_resting_on_guesses, "research ruling rests", "research rulings rest") + " on a value that is not verified.</li>" +
        "<li>" + plural(q.rulings_on_moved_ground, "research ruling rests", "research rulings rest") + " on a value that changed since.</li>" +
        "<li>" + plural(q.items_with_no_value_on_record, "item has", "items have") + " no contract value on record.</li>" +
        "<li>" + plural(q.items_with_no_date, "item has", "items have") + " no date on record.</li>" +
        "<li>" + plural(q.files_still_unread, "required file is", "required files are") + " still unread.</li></ul></section>";
      html += "</div>";
      setMain(html);
    }).catch(fail);
  }

  // ---------------------------------------------------------------- 2. Opportunity Intelligence
  var oppState = { items: [], sort: "urgency", dir: 1, type: "", attr: "", urg: "", kind: "", q: "" };
  function opportunities() {
    if (needsPhlux()) return;
    rpc("ci_opportunities").then(function (items) {
      oppState.items = items || [];
      setMain("<h1>Opportunity intelligence</h1><p class='lede'>Every item in the copy. Value and urgency are scored apart, so an urgent item never reads as a valuable one. " +
        "Select a row to see the evidence. Times are Los Angeles time.</p>" + legend() +
        '<div class="filters">' +
        sel("f-type", "Type", [["", "All types"]].concat(Object.keys(TYPE).map(function (k) { return [k, TYPE[k]]; }))) +
        sel("f-kind", "Where it comes from", [["", "All"]].concat(Object.keys(KIND).map(function (k) { return [k, KIND[k]]; }))) +
        sel("f-attr", "Attractiveness", [["", "All"], ["High", "High"], ["Medium", "Medium"], ["Low", "Low"], ["Unknown", "Unknown"]]) +
        sel("f-urg", "Urgency", [["", "All"], ["Today", "Today"], ["This week", "This week"], ["Later", "Later"], ["No date", "No date"], ["Past", "Past"]]) +
        '<label>Search<input type="text" id="f-q" placeholder="Number, title or buyer"></label>' +
        '<span class="status" id="f-count" aria-live="polite"></span></div><div class="table-wrap"><table class="opps"><thead><tr>' +
        th("number", "Item") + th("attr", "Attractiveness") + th("value", "Value") +
        th("relevance", "Relevance") + th("eligibility", "Eligibility") + th("competition", "Competition") + th("effort", "Effort") +
        th("urgency", "Urgency") + th("missing", "Missing") + '</tr></thead><tbody id="rows"></tbody></table></div><div id="drawer"></div>');
      ["f-type", "f-kind", "f-attr", "f-urg"].forEach(function (id) {
        $("#" + id).addEventListener("change", function (e) { oppState[{ "f-type": "type", "f-kind": "kind", "f-attr": "attr", "f-urg": "urg" }[id]] = e.target.value; drawRows(); });
      });
      $("#f-q").addEventListener("input", function (e) { oppState.q = e.target.value.toLowerCase(); drawRows(); });
      all("th[data-k]").forEach(function (h) {
        var go = function () {
          var k = h.getAttribute("data-k");
          oppState.dir = oppState.sort === k ? -oppState.dir : 1; oppState.sort = k; drawRows();
        };
        h.addEventListener("click", go);
        h.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      });
      drawRows();
    }).catch(fail);
  }
  function sel(id, label, opts) {
    return "<label>" + esc(label) + '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
  }
  function th(k, label) { return '<th data-k="' + k + '" scope="col" tabindex="0">' + esc(label) + "</th>"; }
  function sortKey(i, k) {
    switch (k) {
      case "number": return i.solicitation_number || "";
      case "attr": return RANK[i.attractiveness];
      case "value": return i.value_amount == null ? Infinity : -Number(i.value_amount);
      case "relevance": return RANK[i.relevance_rating];
      case "eligibility": return RANK[i.eligibility_rating];
      case "competition": return RANK[i.competition_rating];
      case "effort": return EFFORT_RANK[i.effort_rating];
      case "missing": return (i.missing || []).length;
      default: return URG[i.urgency] * 1e13 + (i.next_date ? Date.parse(i.next_date) / 1000 : 9e12);
    }
  }
  function drawRows() {
    var s = oppState;
    var rows = s.items.filter(function (i) {
      return (!s.type || i.opportunity_type === s.type) && (!s.kind || i.item_kind === s.kind) && (!s.attr || i.attractiveness === s.attr) &&
        (!s.urg || i.urgency === s.urg) &&
        (!s.q || ((i.solicitation_number || "") + " " + (i.title || "") + " " + (i.buyer || "")).toLowerCase().indexOf(s.q) >= 0);
    });
    rows.sort(function (a, b) { var x = sortKey(a, s.sort), y = sortKey(b, s.sort); return (x < y ? -1 : x > y ? 1 : 0) * s.dir; });
    all("th[data-k]").forEach(function (h) {
      if (h.getAttribute("data-k") === s.sort) h.setAttribute("aria-sort", s.dir > 0 ? "ascending" : "descending"); else h.removeAttribute("aria-sort");
    });
    $("#f-count").textContent = rows.length + " of " + s.items.length + " items";
    $("#rows").innerHTML = rows.map(function (i) {
      var miss = (i.missing || []).length;
      return '<tr data-key="' + esc(i.item_key) + '" tabindex="0"><td class="item"><div class="num">' + esc(i.solicitation_number || "") + " &middot; " +
        esc(TYPE[i.opportunity_type] || "") + "</div>" + '<div class="title">' + esc(i.title || "") + '</div><div class="meta">' + esc(i.status_now || "") + "</div></td><td>" +
        chip(i.attractiveness) + '</td><td class="money">' + (i.value_text ? esc(i.value_text) : '<span class="empty">Unknown</span>') + "</td><td>" +
        chip(i.relevance_rating) + "</td><td>" + chip(i.eligibility_rating) + "</td><td>" + chip(i.competition_rating) + "</td><td>" +
        chip(i.effort_rating, "effort " + i.effort_rating) + "</td><td>" + urgChip(i.urgency) +
        (i.next_date ? '<div class="when">' + esc(shortDate(i.next_date, noTimeOnRecord(i))) + "</div>" : "") +
        '</td><td class="count" title="' + esc((i.missing || []).join("; ") || "Nothing missing") + '">' + esc(miss) + "</td></tr>";
    }).join("");
    all("#rows tr").forEach(function (tr) {
      tr.addEventListener("click", function () { openItem(tr.getAttribute("data-key")); });
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter") openItem(tr.getAttribute("data-key")); });
    });
  }
  function closeItem() {
    $("#drawer").innerHTML = "";
    document.removeEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeItem(); }
  function openItem(key) {
    var i = oppState.items.filter(function (x) { return x.item_key === key; })[0];
    if (!i) return;
    $("#drawer").innerHTML = '<div class="backdrop" id="backdrop"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Item detail">' +
      '<button class="close small" id="close">Close</button>' + itemHead(i) + ratingsLine(i) +
      '<dl class="kv"><dt>Status now</dt><dd>' + esc(i.status_now) + "</dd><dt>Next date</dt><dd>" +
      esc(i.next_date_la ? i.next_date_what + ": " + i.next_date_la : "None on record") + "</dd><dt>Value</dt><dd>" +
      (i.value_text ? esc(i.value_text) + " (" + esc(i.value_kind) + ")" : "Not on record") + "</dd><dt>Missing</dt><dd>" +
      esc((i.missing || []).join("; ") || "Nothing") + "</dd>" +
      (i.layer_decision ? "<dt>Your decision here</dt><dd>" + esc(DECISION[i.layer_decision.decision]) + " (" + esc(i.layer_decision.at_la) + ")</dd>" : "") +
      "<dt>Link</dt><dd>" + (link(i.link) || "None on record") + "</dd></dl>" + evidenceHtml(i, true) + "</aside>";
    $("#close").addEventListener("click", closeItem);
    $("#backdrop").addEventListener("click", closeItem);
    document.addEventListener("keydown", escClose);
    $("#close").focus();
  }

  // ---------------------------------------------------------------- 3. Executive Decision Queue
  function decisions() {
    if (needsPhlux()) return;
    rpc("ci_decision_queue").then(function (q) {
      var waiting = q.waiting || [];
      var html = "<h1>Decisions for PHLUX</h1><p class='lede'>Items that need your decision, most urgent first. Your decision is saved in this layer only; GovCon OS is not changed.</p>" + legend();
      html += waiting.length ? '<div class="cards">' + waiting.map(decisionCard).join("") + "</div>" : '<div class="panel empty">No decision is waiting.</div>';
      var done = q.decided_here || [];
      html += '<h2 class="section">Decided here</h2>' + (done.length ? '<div class="panel"><ul class="items">' + done.map(function (d) {
        return "<li><b>" + esc(DECISION[d.decision] || d.decision) + "</b> &middot; " + esc(d.title || d.item_key) + '<div class="meta">' + esc(d.at_la) + (d.note ? " &middot; " + esc(d.note) : "") + "</div></li>";
      }).join("") + "</ul></div>" : '<p class="empty">None yet.</p>');
      setMain(html);
      all("[data-decide]").forEach(function (b) {
        b.addEventListener("click", function () {
          var card = b.closest(".card");
          var key = card.getAttribute("data-key");
          var note = $("textarea", card).value;
          var st = $(".status", card);
          all("button", card).forEach(function (x) { x.disabled = true; });
          st.textContent = "Saving...";
          rpc("ci_decide", { p_item_key: key, p_decision: b.getAttribute("data-decide"), p_note: note || null })
            .then(function () { decisions(); })
            .catch(function (e) { st.textContent = e.message; all("button", card).forEach(function (x) { x.disabled = false; }); });
        });
      });
    }).catch(fail);
  }
  function decisionCard(i) {
    var ev = function (f) { return (i.evidence || []).filter(function (e) { return e.factor === f; })[0] || {}; };
    var r = function (f) { return i[f + "_rating"]; };
    // Value is upside, shown above; it is not a reason Body Ops could win.
    var good = ["relevance", "eligibility", "competition"].filter(function (f) { return r(f) === "High" || r(f) === "Medium"; });
    var risks = ["relevance", "eligibility", "competition"].filter(function (f) { return r(f) === "Low" || r(f) === "Unknown"; });
    if (r("value") === "Unknown") risks.push("value");
    if (r("effort") === "High" || r("effort") === "Unknown") risks.push("effort");
    var li = function (fs) {
      return fs.length ? "<ul>" + fs.map(function (f) { var e = ev(f); return "<li><b>" + esc(FACTOR[f]) + " (" + esc(r(f)) + "):</b> " + tag(e.label || "Unknown") + " " + esc(e.statement || "") + "</li>"; }).join("") + "</ul>"
        : "<p class='empty'>None on record.</p>";
    };
    return '<article class="card" data-key="' + esc(i.item_key) + '">' + itemHead(i) + ratingsLine(i) +
      '<dl class="kv"><dt>Why it is here</dt><dd>' + esc(i.needs_phlux_why) + "</dd>" +
      "<dt>Deadline</dt><dd>" + esc(i.next_date_la ? i.next_date_what + ": " + i.next_date_la : "None on record") + "</dd>" +
      "<dt>Upside</dt><dd>" + (i.value_text ? tag("Fact") + " " + esc(i.value_text) + " (" + esc(i.value_kind) + ")" : tag("Unknown") + " No contract value is on record.") + "</dd>" +
      "<dt>The exact action</dt><dd>" + esc(i.exact_action) + "</dd>" +
      "<dt>The rule's suggestion</dt><dd>" + tag("Assessment") + " " + esc(DECISION[i.suggested_decision] || "") + ". " + esc(i.suggested_why || "") + "</dd></dl>" +
      "<h3>Reasons Body Ops could win</h3>" + li(good) + "<h3>Major risks and unknowns</h3>" + li(risks) +
      evidenceHtml(i) + (link(i.link) ? "<p>" + link(i.link) + "</p>" : "") +
      '<label class="note">Note (optional)<textarea maxlength="2000" rows="2"></textarea></label>' +
      '<div class="actions"><button class="primary" data-decide="go">Go</button><button data-decide="no_go">No go</button>' +
      '<button data-decide="research_next">Research next</button><span class="status" aria-live="polite"></span></div></article>';
  }

  // ---------------------------------------------------------------- 4. Virtual Assistant Operations Queue
  function assistant() {
    rpc("ci_va_queue").then(function (tasks) {
      var phlux = (me.seats || []).indexOf("phlux") >= 0;
      var open = tasks.filter(function (t) { return t.status !== "done" && t.status !== "dropped"; });
      var closed = tasks.filter(function (t) { return t.status === "done" || t.status === "dropped"; });
      var html = "<h1>Virtual assistant queue</h1><p class='lede'>" + (phlux ? "Every task, with its owner. " : "Your tasks. ") +
        "Updates are saved in this layer only; GovCon OS is not changed, and nothing is sent to anyone.</p>";
      html += open.length ? '<div class="cards">' + open.map(function (t) { return taskCard(t, phlux); }).join("") + "</div>" : '<div class="panel empty">No open task.</div>';
      if (phlux) {
        html += '<section class="panel add"><h2>Add a task</h2><form id="addtask"><label class="note">What to do<textarea id="nt-task" required maxlength="1000" rows="2"></textarea></label>' +
          '<label class="note">It is done when<textarea id="nt-done" required maxlength="1000" rows="2"></textarea></label>' +
          '<div class="filters"><label>Priority<select id="nt-pri"><option value="1">1 (first)</option><option value="2" selected>2</option><option value="3">3</option></select></label>' +
          '<label>Due (this computer\'s time)<input type="datetime-local" id="nt-due"></label><button class="primary" type="submit">Add the task</button><span class="status" id="nt-status" aria-live="polite"></span></div></form></section>';
      }
      html += '<h2 class="section">Done or dropped</h2>' + (closed.length ? '<div class="panel"><ul class="items">' + closed.map(function (t) {
        return "<li>" + esc(t.task) + '<div class="meta">' + esc(STATUS[t.status]) + (t.va_note ? " &middot; " + esc(t.va_note) : "") + "</div></li>";
      }).join("") + "</ul></div>" : '<p class="empty">None yet.</p>');
      setMain(html);
      all("[data-status]").forEach(function (b) {
        b.addEventListener("click", function () {
          var card = b.closest(".card");
          var st = $(".status", card);
          all("button", card).forEach(function (x) { x.disabled = true; });
          st.textContent = "Saving...";
          rpc("ci_task_update", { p_task: card.getAttribute("data-id"), p_status: b.getAttribute("data-status"), p_note: $("textarea", card).value || null })
            .then(function () { assistant(); })
            .catch(function (e) { st.textContent = e.message; all("button", card).forEach(function (x) { x.disabled = false; }); });
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
  function taskCard(t, phlux) {
    var btn = function (s, label) { return t.status === s ? "" : '<button data-status="' + s + '"' + (s === "done" ? ' class="primary"' : "") + ">" + esc(label) + "</button>"; };
    return '<article class="card" data-id="' + esc(t.id) + '"><div class="meta">' + chip("Priority " + t.priority, t.priority === 1 ? "Low" : "Unknown") +
      chip(STATUS[t.status] || t.status, t.status === "blocked" ? "Low" : t.status === "in_progress" ? "Medium" : "Unknown") +
      "<span>" + (t.due_la ? "Due " + esc(t.due_la) : "No due date") + "</span>" +
      (t.solicitation_number ? '<span class="num">' + esc(t.solicitation_number) + "</span>" : "") + "</div>" +
      '<p class="title">' + esc(t.task) + "</p>" + '<dl class="kv"><dt>Done when</dt><dd>' + esc(t.done_when) + "</dd><dt>Why</dt><dd>" + esc(t.evidence || "") + "</dd>" +
      (phlux ? "<dt>Owner</dt><dd>" + esc(t.owner_email || "Not assigned") + "</dd>" : "") +
      (t.link ? "<dt>Link</dt><dd>" + link(t.link, "Open") + "</dd>" : "") + (t.va_note ? "<dt>Note</dt><dd>" + esc(t.va_note) + "</dd>" : "") + "</dl>" +
      '<label class="note">Note (optional)<textarea maxlength="2000" rows="2"></textarea></label><div class="actions">' +
      btn("in_progress", "Start") + btn("blocked", "Blocked") + btn("done", "Done") + (phlux ? btn("dropped", "Drop") : "") + '<span class="status" aria-live="polite"></span></div></article>';
  }

  // ---------------------------------------------------------------- 5. Revenue Pipeline
  function pipeline() {
    if (needsPhlux()) return;
    rpc("ci_pipeline").then(function (p) {
      var gp = p.gross_profit || {};
      var items = p.potential_value_items || [];
      var html = "<h1>Revenue pipeline</h1><p class='lede'>Figures only where they are on record. Nothing here is an estimate, and no figures of different kinds are added together.</p>" + legend() +
        '<div class="panel wide"><div class="stats">' +
        '<div class="stat"><b>' + esc(num(p.open_priced_bids)) + "</b><span>open priced bids</span></div>" +
        '<div class="stat"><b>' + esc(num(p.open_priced_bids_with_value)) + "</b><span>of them with a figure on record</span></div>" +
        '<div class="stat"><b>' + esc(p.our_offers_on_record == null ? "Not counted" : num(p.our_offers_on_record)) + "</b><span>of them with our own priced offer on record</span></div>" +
        "</div></div>";
      html += '<section class="panel wide"><h2>Open priced bids and the figure on record</h2><p class="lede">The figure is the size of the work as recorded ' +
        "(the solicitation's estimate, the current or last contract, or our own priced offer). It is not Body Ops revenue unless it is our own offer and we win.</p>" +
        (items.length ? '<div class="table-wrap"><table><thead><tr><th scope="col">Notice</th><th scope="col">Figure on record</th><th scope="col">Attractiveness</th>' +
          '<th scope="col">Effort</th><th scope="col">Status</th><th scope="col">Next date</th></tr></thead><tbody>' + items.map(function (x) {
            return '<tr class="static"><td class="item"><div class="num">' + esc(x.number) + '</div><div class="title">' + esc(x.title) + "</div></td><td>" +
              (x.value ? tag("Fact") + ' <span class="money">' + esc(x.value) + '</span><div class="meta">' + esc(x.value_kind) + "</div>" : tag("Unknown") + " not on record") +
              "</td><td>" + chip(x.attractiveness) + "</td><td>" + chip(x.effort, "effort " + x.effort) + "</td><td>" + esc(x.status) + "</td><td>" + esc(x.next_date_la || "None on record") + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="empty">No open priced bid.</p>') + "</section>";
      html += '<div class="grid">';
      html += '<section class="panel"><h2>Estimated gross profit</h2><p>' + tag(gp.label || "Unknown") + " " +
        esc(gp.text || (gp.total + " across " + gp.bids + " bid" + (gp.bids === 1 ? "" : "s") + "; " + gp.formula)) + "</p></section>";
      html += '<section class="panel"><h2>Proposal effort</h2><ul class="items">' + ["High", "Medium", "Low", "Unknown"].filter(function (k) { return (p.effort || {})[k]; }).map(function (k) {
        return "<li>" + chip("Effort: " + k, "effort " + k) + " " + plural(p.effort[k], "open priced bid") + "</li>";
      }).join("") + "</ul></section>";
      html += '<section class="panel"><h2>Awards and realized revenue</h2><p>Awards: ' + esc(p.awards) + "</p><p>Realized revenue: " + esc(p.realized_revenue) + "</p></section>";
      html += '<section class="panel"><h2>Delivery obligations</h2>' + ((p.delivery_obligations || []).length ? '<ul class="items">' + p.delivery_obligations.map(function (d) {
        return '<li><div class="num">' + esc(d.number) + "</div><div>" + esc(d.title) + '</div><div class="meta">Period: ' + esc(d.period || "not on record") + " &middot; Units: " + esc(d.units || "not on record") + "</div></li>";
      }).join("") + "</ul>" : '<p class="empty">None on record.</p>') + "</section>";
      html += '<section class="panel wide"><h2>Responses sent, by month</h2><div class="table-wrap"><table><thead><tr><th scope="col">Month</th><th scope="col">Responses</th>' +
        '<th scope="col">Priced offers</th><th scope="col">Priced offers, total</th></tr></thead><tbody>' +
        (p.responses_by_month || []).map(function (m) {
          return '<tr class="static"><td>' + esc(monthLabel(m.month)) + "</td><td>" + esc(m.responses) + "</td><td>" + esc(m.priced_offers) + '</td><td class="money">' + esc(m.priced_total || "None") + "</td></tr>";
        }).join("") + "</tbody></table></div></section>";
      html += "</div>";
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
