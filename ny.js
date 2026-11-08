/* Capture Intelligence: the Needs You page (file 0014; reading statuses from GovCon OS, files 0015 and 0016). Lists the file tasks, takes files dropped on a task, and
   shows exactly what the database has recorded. Reads and writes only the Capture Intelligence project. */
(function () {
  "use strict";
  var cfg = window.CI_CONFIG || {};
  var client = null, me = null, data = null, session = null;
  var FN = (cfg.url || "") + "/functions/v1/needs-you";
  var OK_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "xlsm", "csv", "txt", "rtf", "zip", "ppt", "pptx", "png", "jpg", "jpeg", "tif", "tiff"];
  var REASONS = [["login", "Login or permission required"], ["not_posted", "Document not posted yet"],
    ["broken_link", "Broken link or portal unavailable"], ["cannot_download", "Document cannot be downloaded"],
    ["unreadable", "File is password protected or unreadable"], ["unclear", "Missing or unclear document requirements"],
    ["someone_else", "Another person must take action"], ["other", "Other"]];
  var NEEDS_PHLUX_BY_DEFAULT = { login: true, someone_else: true };
  var STATUS = { open: "Open", in_progress: "In progress", blocked: "Blocked", done: "Done", dropped: "Dropped" };
  var READING = {
    not_sent: ["Recorded. Not read yet", "Low", "The file is stored and linked to this task. It has not been read yet; the note says what happens next."],
    queued: ["Queued for reading", "Medium", "Sent to GovCon OS; waiting for its answer."],
    read: ["Read", "Medium", "GovCon OS took the text off its pages. No saved ruling uses it yet, so it is not analyzed."],
    partial: ["Partial", "Low", "GovCon OS found text on only some pages. For a lead the pages with text go to the lead reader; a federal notice waits for a copy with text on every page. The note says which."],
    analyzed: ["Analyzed", "Medium", "A saved ruling uses this file (the lead reader's for a lead, the qualification run's for a federal notice). Something is still open; the note says what."],
    complete: ["Complete", "High", "A saved ruling uses this file, and GovCon OS needs nothing more from this file."],
    failed: ["Failed", "Low", "GovCon OS could not take text from this file. Replace it with a better copy, or report it blocked."],
    needs_attention: ["Needs attention", "Low", "Something about this file needs a person. See the note."]
  };
  var reloadTimer = null, autoReloads = 0, lastCheck = 0, uploading = 0;

  function $(s, el) { return (el || document).querySelector(s); }
  function esc(s) {
    return s == null ? "" : String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function chip(text, cls) { return '<span class="chip ' + esc(cls || "Muted") + '">' + esc(text) + "</span>"; }
  function setMain(html) { $("#main").innerHTML = html; }
  function mb(n) { return n == null ? "" : (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"); }
  function ext(name) { var m = /\.([A-Za-z0-9]+)$/.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
  function outLink(url, text) {
    return url && /^https?:\/\//i.test(url) ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + "</a>" : "";
  }
  function rpc(name, args) { return client.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function fail(err) {
    var m = err && (err.message || err.error_description || err);
    if (/ci_needs_you/.test(String(m)) && /(Could not find|does not exist)/i.test(String(m))) {
      setMain('<div class="panel"><h2>One step left</h2><p>This page needs database file 0014 (CAPTURE_INTEL_0014_NEEDS_YOU_run_in_Body_Ops_Capture_Intel.sql). PHLUX runs it in the SQL Editor of the Body Ops Capture Intel project, then this page works.</p></div>');
      return;
    }
    setMain('<div class="panel"><h2>Something went wrong</h2><p>' + esc(m) + "</p><p>Reload the page. If it happens again, tell PHLUX what this box says.</p></div>");
  }
  function callDoor(body) {
    return client.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) throw new Error("Your sign-in has run out. Reload the page and sign in again.");
      return fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.key, Authorization: "Bearer " + s.access_token },
        body: JSON.stringify(body) });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.error || ("The upload door answered " + res.status + "."));
        return j;
      });
    });
  }
  function sha256(file) {
    return file.arrayBuffer().then(function (buf) { return crypto.subtle.digest("SHA-256", buf); }).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }
  function putFile(url, file, onPct) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("x-upsert", "false");
      x.setRequestHeader("content-type", file.type || "application/octet-stream");
      x.setRequestHeader("apikey", cfg.key);
      x.upload.onprogress = function (e) { if (e.lengthComputable) onPct(Math.floor(e.loaded * 100 / e.total)); };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) resolve();
        else reject(new Error("Storage did not take the file (" + x.status + "): " + String(x.responseText || "").slice(0, 160)));
      };
      x.onerror = function () { reject(new Error("The upload was interrupted. Check the connection and try again.")); };
      x.send(file);
    });
  }

  // ---------------------------------------------------------------- sign in and header
  function showSignIn() {
    $("#who").innerHTML = "";
    $("#copybar").innerHTML = "<strong>Not signed in.</strong><span>Nothing is shown until you sign in.</span>";
    setMain('<div class="panel signin"><h1>Needs You</h1><p class="lede">Sign in with your own email address. We send you a sign-in link; open it on this device and it brings you back here.</p>' +
      '<form id="signin"><label for="email">Email address</label><input id="email" type="email" required autocomplete="email">' +
      '<button class="primary" type="submit">Send me a sign-in link</button></form><p class="status" id="signin-status" aria-live="polite"></p></div>');
    $("#signin").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("#signin button"), st = $("#signin-status");
      btn.disabled = true; st.textContent = "Sending...";
      client.auth.signInWithOtp({ email: $("#email").value.trim(), options: { emailRedirectTo: location.href.split("#")[0].split("?")[0] } })
        .then(function (r) {
          btn.disabled = false;
          st.textContent = r.error ? "Could not send the link: " + r.error.message : "Check your email for the sign-in link. It can take a minute to arrive.";
        });
    });
  }
  function header() {
    var phlux = (me.seats || []).indexOf("phlux") >= 0;
    $("#who").innerHTML = "<span>" + esc(me.email) + " &middot; " + (phlux ? "PHLUX" : "Virtual assistant") + '</span><button class="small" id="signout">Sign out</button>';
    $("#signout").addEventListener("click", function () { client.auth.signOut().finally(function () { location.reload(); }); });
    Array.prototype.forEach.call(document.querySelectorAll("nav a[data-phlux]"), function (a) { if (!phlux) a.classList.add("hidden"); });
    var c = me.copy;
    $("#copybar").innerHTML = c ? "<strong>Assignments from the copy of GovCon OS loaded " + esc(c.taken_at_la) + "</strong><span>The copy refreshes at 10:50 AM and 2:50 PM. Files and blocked reports are saved the moment you make them.</span>"
      : "<strong>No copy of GovCon OS is loaded yet.</strong>";
  }

  // ---------------------------------------------------------------- the list
  // The same rule the database uses: files on a lead or a federal notice go to GovCon OS for reading.
  function isLead(i) { return /^lead:/.test((i && i.item_key) || ""); }
  function readByGovcon(i) { return /^(lead|notice):/.test((i && i.item_key) || ""); }
  function decisionChip(i) {
    if (i.decision === "approved") return chip("Approved for work", "High");
    if (i.decision === "passed") return chip("Passed", "Muted");
    return chip("Awaiting a decision", "Info");
  }
  function priorityChip(i) {
    var p = i.priority || "";
    return chip(p, /^Do first/.test(p) ? "Low" : p === "This week" ? "Medium" : "Muted");
  }
  function itemState(i) {
    var open = (i.blocks || []).filter(function (b) { return !b.resolved; });
    var files = i.files || [];
    // A closed task is not the same as read files: each file keeps its own reading status below.
    if (i.status === "done") return "Task closed";
    if (i.status === "dropped") return "Task dropped";
    if (open.length) return "Blocked";
    var wanted = (i.files_wanted || []).map(function (w) { return w.name; });
    var got = files.map(function (f) { return f.for_file; });
    var missing = wanted.filter(function (w) { return got.indexOf(w) < 0; });
    if (!files.length) return "Waiting for files";
    if (wanted.length && missing.length) return "Some files received: " + missing.length + " still missing";
    var st = files.map(function (f) { return f.reading_status; });
    var has = function (s) { return st.indexOf(s) >= 0; };
    if (has("needs_attention") || has("failed")) return "A file needs attention";
    if (!readByGovcon(i)) return "Files received: waiting for PHLUX to read them";
    if (has("not_sent") || has("queued")) return "Files received: waiting for GovCon OS";
    if (has("read") || has("partial")) return isLead(i) ? "Files read: waiting for the lead reader" : "Files read: waiting for the qualification run";
    if (has("analyzed")) return "Files analyzed: the task is still open";
    return "Files complete";
  }
  function fileRow(f) {
    var r = READING[f.reading_status] || [f.reading_status, "Muted", ""];
    var pages = f.pages_total != null ? " " + esc((f.pages_read == null ? 0 : f.pages_read) + " of " + f.pages_total + " pages read.") : "";
    return '<li class="nyfile"><div><b>' + esc(f.name) + "</b> " + chip(r[0], r[1]) + '</div><div class="subtle">' + esc(mb(f.bytes)) +
      " · received " + esc(f.recorded_la) + " · by " + esc(f.by) + (f.for_file ? " · for " + esc(f.for_file) : "") +
      ' · SHA-256 <span class="num">' + esc(String(f.sha256).slice(0, 12)) + "</span></div>" +
      '<div class="subtle">' + esc(r[2]) + pages + (f.reading_note ? " " + esc(f.reading_note) : "") + "</div>" +
      '<button class="small" data-open="' + esc(f.id) + '">Open the stored file</button></li>';
  }
  function blockBox(b, canClear) {
    return '<div class="nyblock' + (b.resolved ? " cleared" : "") + '"><b>' + (b.resolved ? "Was blocked: " : "Blocked: ") + esc(b.reason_label) + "</b>" +
      (b.notes ? "<p>" + esc(b.notes) + "</p>" : "") +
      '<div class="subtle">Reported by ' + esc(b.by) + " " + esc(b.reported_la) + (b.for_file ? " · file: " + esc(b.for_file) : "") +
      (b.needs_phlux ? " · needs PHLUX" : "") + (b.retry_later ? " · can be tried again later" : "") + "</div>" +
      (b.resolved ? '<div class="subtle">Cleared by ' + esc(b.resolved_by) + " " + esc(b.resolved_la) + ": " + esc(b.resolution_note) + "</div>"
        : (canClear ? '<div class="actions"><input type="text" placeholder="What changed? (needed to clear it)" data-clear-note="' + esc(b.id) + '"><button class="small" data-clear="' + esc(b.id) + '">Clear this block</button></div>' : "")) +
      "</div>";
  }
  function card(i) {
    var phlux = me.phlux, active = i.status !== "done" && i.status !== "dropped";
    var assigned = i.section === "assigned";
    var wanted = i.files_wanted || [];
    var h = '<article class="card nycard" id="t-' + esc(i.task) + '">';
    h += '<div class="card-head"><div><div class="num">' + esc(i.number || "") + "</div><div class=\"pri-title\">" + esc(i.title || "") + "</div>" +
      '<div class="subtle">' + esc(i.buyer || "Buyer not on record") + "</div></div><div>" + chip(itemState(i), /^(Blocked|A file needs attention)$/.test(itemState(i)) ? "Low" : "Info") + "</div></div>";
    h += '<div class="meta">' + priorityChip(i) + decisionChip(i) + (phlux ? chip("Owner: " + i.owner, "Muted") : "") + "</div>";
    if (i.section === "check_first") h += '<p class="notice"><b>Check first, do not download yet.</b> This may be the same bid as ' + esc(i.duplicate_of) + ". PHLUX confirms before anyone works it.</p>";
    if (i.section === "not_needed") h += '<p class="notice"><b>Probably not needed.</b> ' + esc(i.not_needed_why) + (phlux ? " Resolve it below if you agree." : " No work is needed; PHLUX will close it.") + "</p>";
    h += '<dl class="kv">';
    h += "<dt>Deadline</dt><dd>" + (i.close_la ? "Closes " + esc(i.close_la) : "No closing date on record") + (i.close_note ? '<div class="subtle">' + esc(i.close_note) + "</div>" : "") +
      (i.due_la ? '<div class="subtle">This task is due ' + esc(i.due_la) + "</div>" : "") + "</dd>";
    h += "<dt>Where</dt><dd>" + esc(i.portal) + (i.page_url || i.link ? '<div class="nylinks">' + outLink(i.page_url, i.kind === "notice" ? "Open the notice page" : "Open the listing page") +
      (i.link && i.link !== i.page_url ? outLink(i.link, i.kind === "notice" ? "Open the file link" : "Open the source link") : "") + "</div>" : '<div class="subtle">No link on record. Search the listing site for the number above.</div>') + "</dd>";
    h += "<dt>What to do</dt><dd>" + esc(i.task_text || "") + (i.done_when ? '<div class="subtle">Done when: ' + esc(i.done_when) + "</div>" : "") + "</dd>";
    h += "<dt>Files needed</dt><dd>" + (wanted.length ? "<ul class=\"plain\">" + wanted.map(function (w) {
      return "<li><b>" + esc(w.name) + "</b>" + (w.why ? '<div class="subtle">Why the system could not read it: ' + esc(w.why) + "</div>" : "") + "</li>";
    }).join("") + "</ul>" : "File names are not on record for this one. Get every bid document the page lists for this number.") + "</dd>";
    h += "</dl>";
    (i.blocks || []).forEach(function (b) { h += blockBox(b, active && !b.resolved); });
    if ((i.files || []).length) h += "<h3>Files received</h3><ul class=\"plain nyfiles\">" + i.files.map(fileRow).join("") + "</ul>";
    if (active && (assigned || phlux)) {
      h += '<div class="nydrop" data-drop="' + esc(i.task) + '" tabindex="0"><b>Drop the downloaded files here</b><span>or</span>' +
        '<label class="button small">Choose files<input type="file" multiple hidden data-pick="' + esc(i.task) + '"></label>' +
        (wanted.length > 1 ? '<label class="subtle">These files are for <select data-for="' + esc(i.task) + '"><option value="">(the file named in each file\'s name)</option>' +
          wanted.map(function (w) { return '<option value="' + esc(w.name) + '">' + esc(w.name) + "</option>"; }).join("") + "</select></label>" : "") +
        '<span class="subtle">PDF, Word, Excel, PowerPoint, text, CSV, ZIP or image files, up to ' + esc(mb(data.max_bytes)) + " each.</span></div>" +
        '<ul class="plain nyprogress" data-progress="' + esc(i.task) + '"></ul>';
      h += '<div class="actions"><button class="small" data-blockopen="' + esc(i.task) + '">I\'m blocked</button>' +
        (phlux ? '<input type="text" placeholder="Why it is resolved (needed)" data-resolve-note="' + esc(i.task) + '"><button class="small" data-resolve="' + esc(i.task) + '">Resolve this task</button>' : "") + "</div>";
      h += '<form class="nyblockform hidden" data-blockform="' + esc(i.task) + '"><label>What is blocking you?<select name="reason">' +
        REASONS.map(function (r) { return '<option value="' + r[0] + '">' + esc(r[1]) + "</option>"; }).join("") + "</select></label>" +
        (wanted.length ? '<label>Which file?<select name="for_file"><option value="">All of them</option>' + wanted.map(function (w) { return '<option value="' + esc(w.name) + '">' + esc(w.name) + "</option>"; }).join("") + "</select></label>" : "") +
        '<label>Your notes<textarea name="notes" rows="3" placeholder="What you tried and what you saw"></textarea></label>' +
        '<label class="check"><input type="checkbox" name="needs_phlux" checked> This needs PHLUX (a login, an approval or a decision)</label>' +
        '<label class="check"><input type="checkbox" name="retry_later"> It can be tried again later</label>' +
        '<div class="actions"><button class="primary small" type="submit">Save the blocked report</button><button class="small" type="button" data-blockcancel="' + esc(i.task) + '">Cancel</button></div>' +
        '<p class="status" aria-live="polite"></p></form>';
    }
    h += '<p class="status" data-status="' + esc(i.task) + '" aria-live="polite"></p></article>';
    return h;
  }
  function render() {
    var items = data.items || [];
    var mine = items.filter(function (i) { return i.section === "assigned"; });
    var byPortal = {};
    mine.forEach(function (i) { (byPortal[i.portal] = byPortal[i.portal] || []).push(i); });
    var portals = Object.keys(byPortal).sort(function (a, b) {
      var ra = Math.min.apply(null, byPortal[a].map(rank)), rb = Math.min.apply(null, byPortal[b].map(rank));
      return ra - rb || a.localeCompare(b);
    });
    var blocked = mine.filter(function (i) { return itemState(i) === "Blocked"; }).length;
    var waiting = mine.filter(function (i) { return /waiting for/.test(itemState(i)); }).length;
    var html = '<section class="panel"><h1>Needs You</h1><p class="lede">' + (me.phlux ? "The files only a person can get, who has them, what came in, and what is blocked."
      : "The files the system cannot open. Sign in to the site named on each one, download the files, and drop them on that same item here.") + "</p>" +
      '<p class="counts"><span class="count">' + mine.length + "</span> to get &nbsp; <span class=\"count\">" + blocked + "</span> blocked &nbsp; <span class=\"count\">" + waiting + "</span> received, waiting for reading</p>" +
      '<p class="notice"><b>How files are read.</b> A file on a lead goes to GovCon OS by itself the moment it is recorded. It shows <b>Read</b> when GovCon OS has the text of its pages, <b>Analyzed</b> when the daily lead reader (7:47 AM Los Angeles time) saves a ruling that uses it, and <b>Complete</b> only when that lead needs nothing more from a person. Closing a task does not make its files Complete. A file on a federal notice goes to GovCon OS the same way, as a copy of the one posted file it is for: choose that file when the task lists more than one. It shows <b>Analyzed</b> when the qualification run (8:00 AM and 12:00 PM Los Angeles time) saves a ruling that read it, and <b>Complete</b> when that ruling is a verdict. A copy with pages that have no text is kept, and the notice still waits for that file.</p>' +
      "</section>";
    if (!mine.length) html += '<section class="panel"><p class="empty">Nothing to get right now.</p></section>';
    portals.forEach(function (p) {
      html += '<section class="nyportal"><h2 class="section">' + esc(p) + ' <span class="subtle">' + byPortal[p].length + (byPortal[p].length === 1 ? " item" : " items") + "</span></h2><div class=\"cards\">" +
        byPortal[p].map(card).join("") + "</div></section>";
    });
    [["check_first", "Check first: possibly the same bid as another record"], ["not_needed", "Probably not needed any more"], ["done", "Done in the last 7 days"]].forEach(function (s) {
      var list = items.filter(function (i) { return i.section === s[0]; });
      if (list.length) html += '<details class="panel nysection"' + (s[0] === "check_first" ? " open" : "") + '><summary>' + esc(s[1]) + " (" + list.length + ")</summary><div class=\"cards\">" + list.map(card).join("") + "</div></details>";
    });
    setMain(html);
    wire();
  }
  function rank(i) {
    var p = i.priority || "";
    return /^Do first/.test(p) ? 1 : p === "This week" ? 2 : p === "Later" ? 3 : 4;
  }
  function load(keepScroll) {
    var y = window.scrollY;
    return rpc("ci_needs_you").then(function (d) {
      data = d; render(); if (keepScroll) window.scrollTo(0, y);
      if (anyQueued()) reloadSoon();
    }).catch(fail);
  }
  function anyQueued() {
    return (data.items || []).some(function (i) { return (i.files || []).some(function (f) { return f.reading_status === "queued"; }); });
  }
  // Never reload while the person is typing, has a form open, or is uploading, so nothing they started is lost.
  function busy() {
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "file") return true;
    if (document.querySelector("[data-blockform]:not(.hidden)")) return true;
    if (Array.prototype.some.call(document.querySelectorAll("input[type=text], textarea, select[data-for]"), function (x) { return x.value; })) return true;
    return uploading > 0;
  }
  function reloadSoon() {
    if (reloadTimer || autoReloads >= 8) return;
    reloadTimer = setTimeout(function () {
      reloadTimer = null;
      if (busy()) { reloadSoon(); return; }
      autoReloads++;
      load(true);
    }, 8000);
  }
  // Asks the database to send any lead file not sent yet, and to ask GovCon OS what it confirms about the files
  // it holds. The database limits how often each happens; this page asks at most once a minute.
  function checkReading() {
    if (Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    rpc("ci_ny_check_reading").then(function (r) {
      if (r && (r.handovers_started > 0 || r.status_check === "started")) { autoReloads = 0; reloadSoon(); }
    }).catch(function () { /* the list still shows what is recorded */ });
  }
  function item(task) { return (data.items || []).filter(function (i) { return i.task === task; })[0]; }

  // ---------------------------------------------------------------- uploads
  function progressRow(task, name) {
    var ul = $('[data-progress="' + task + '"]');
    var li = document.createElement("li");
    li.innerHTML = "<b>" + esc(name) + '</b> <span class="nystep">Checking the file...</span>';
    ul.appendChild(li);
    return {
      set: function (t) { $(".nystep", li).textContent = t; },
      ok: function (t) { $(".nystep", li).innerHTML = chip("Recorded", "High") + " " + esc(t); },
      bad: function (t, retry) {
        $(".nystep", li).innerHTML = chip("Not recorded", "Low") + " " + esc(t) + (retry ? ' <button class="small">Try recording again</button>' : "");
        if (retry) $("button", li).addEventListener("click", retry);
      }
    };
  }
  function recordSlot(slot, row, lead) {
    row.set("Uploaded. Recording it in the database...");
    return rpc("ci_ny_record_upload", { p_slot: slot }).then(function (r) {
      if (r.status === "duplicate") row.ok(r.message || ("Already received as " + r.file_name + " on " + r.recorded_la + ". Not recorded twice."));
      else row.ok("Linked to this task " + r.recorded_la + ". " + (lead ? "Sent to GovCon OS for reading." : "Not read yet: PHLUX reads this kind of file with Claude."));
      return true;
    }).catch(function (e) {
      row.bad("The file is stored, but the database did not record it: " + (e.message || e) + " The file is kept.", function () { recordSlot(slot, row, lead).then(function (ok) { if (ok) load(true); }); });
      return false;
    });
  }
  function uploadOne(task, file, forFile) {
    var row = progressRow(task, file.name);
    var i = item(task);
    if (!i) { row.bad("This task is no longer on the list. Reload the page."); return Promise.resolve(false); }
    if (OK_EXT.indexOf(ext(file.name)) < 0) { row.bad("This page takes PDF, Word, Excel, PowerPoint, text, CSV, ZIP and image files."); return Promise.resolve(false); }
    if (!file.size) { row.bad("The file is empty."); return Promise.resolve(false); }
    if (data.max_bytes && file.size > data.max_bytes) { row.bad("The file is " + mb(file.size) + ". The most this page takes is " + mb(data.max_bytes) + ". Report it blocked and say the file is too large."); return Promise.resolve(false); }
    var wanted = (i.files_wanted || []).map(function (w) { return w.name; });
    if (!forFile) forFile = wanted.length === 1 ? wanted[0] : (wanted.indexOf(file.name) >= 0 ? file.name : null);
    row.set("Working out its checksum...");
    return sha256(file).then(function (sha) {
      row.set("Getting an upload place...");
      return callDoor({ action: "upload", task: task, file_name: file.name, bytes: file.size, sha256: sha, mime: file.type || null, for_file: forFile });
    }).then(function (r) {
      if (r.status === "duplicate") { row.ok(r.message || ("Already received as " + r.file_name + " on " + r.recorded_la + ". Not uploaded again.")); return true; }
      row.set("Uploading 0%");
      return putFile(r.upload_url, file, function (p) { row.set("Uploading " + p + "%"); }).then(function () { return recordSlot(r.slot, row, readByGovcon(i)); });
    }).catch(function (e) { row.bad(e.message || String(e)); return false; });
  }
  function uploadMany(task, files) {
    var sel = $('[data-for="' + task + '"]');
    var forFile = sel && sel.value ? sel.value : null;
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var chain = Promise.resolve(), any = false;
    uploading++;
    list.forEach(function (f) { chain = chain.then(function () { return uploadOne(task, f, forFile).then(function (ok) { any = any || ok; }); }); });
    chain.catch(function () { /* each file reports its own result */ }).then(function () {
      uploading--;
      if (any) { autoReloads = 0; setTimeout(function () { load(true); }, 600); }
    });
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-drop]"), function (z) {
      var task = z.getAttribute("data-drop");
      ["dragenter", "dragover"].forEach(function (ev) { z.addEventListener(ev, function (e) { e.preventDefault(); z.classList.add("over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { z.addEventListener(ev, function (e) { e.preventDefault(); z.classList.remove("over"); }); });
      z.addEventListener("drop", function (e) { uploadMany(task, e.dataTransfer && e.dataTransfer.files); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-pick]"), function (inp) {
      inp.addEventListener("change", function () { uploadMany(inp.getAttribute("data-pick"), inp.files); inp.value = ""; });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-open]"), function (b) {
      b.addEventListener("click", function () {
        b.disabled = true;
        // The link is a download (the stored file comes back as an attachment), so this page stays open.
        callDoor({ action: "open", file: b.getAttribute("data-open") }).then(function (r) { window.location.assign(r.url); })
          .catch(function (e) { alert(e.message || e); }).finally(function () { b.disabled = false; });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-blockopen]"), function (b) {
      b.addEventListener("click", function () { $('[data-blockform="' + b.getAttribute("data-blockopen") + '"]').classList.remove("hidden"); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-blockcancel]"), function (b) {
      b.addEventListener("click", function () { $('[data-blockform="' + b.getAttribute("data-blockcancel") + '"]').classList.add("hidden"); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-blockform]"), function (f) {
      var task = f.getAttribute("data-blockform");
      f.reason.addEventListener("change", function () { f.needs_phlux.checked = !!NEEDS_PHLUX_BY_DEFAULT[f.reason.value]; });
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var st = $(".status", f);
        st.textContent = "Saving...";
        rpc("ci_ny_blocked", { p_task: task, p_reason: f.reason.value, p_notes: f.notes.value, p_needs_phlux: f.needs_phlux.checked,
          p_retry_later: f.retry_later.checked, p_for_file: f.for_file ? (f.for_file.value || null) : null })
          .then(function () { load(true); }).catch(function (err) { st.textContent = "Not saved: " + (err.message || err); });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-clear]"), function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-clear"), note = $('[data-clear-note="' + id + '"]').value;
        b.disabled = true;
        rpc("ci_ny_unblock", { p_block: id, p_note: note }).then(function () { load(true); })
          .catch(function (err) { b.disabled = false; alert("Not cleared: " + (err.message || err)); });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-resolve]"), function (b) {
      b.addEventListener("click", function () {
        var task = b.getAttribute("data-resolve"), note = $('[data-resolve-note="' + task + '"]').value;
        b.disabled = true;
        rpc("ci_ny_resolve", { p_task: task, p_note: note }).then(function () { load(true); })
          .catch(function (err) { b.disabled = false; alert("Not resolved: " + (err.message || err)); });
      });
    });
  }

  // ---------------------------------------------------------------- start
  var foot = $(".foot");
  if (foot) foot.textContent = "Files dropped here are stored in Capture Intelligence's own private storage and recorded against the task you dropped them on. " +
    "A file on a lead or a federal notice is then sent to GovCon OS, which keeps its own copy in its document library and takes the text off its pages for the lead reader or the qualification run. " +
    "This page never sends email or posts messages.";
  if (!cfg.url || !cfg.key || !window.supabase) { setMain('<div class="panel"><h2>Not set up yet</h2></div>'); return; }
  client = window.supabase.createClient(cfg.url, cfg.key, { auth: { flowType: "implicit", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true } });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });
  client.auth.getSession().then(function (r) {
    session = r.data && r.data.session;
    if (!session) { showSignIn(); return; }
    return rpc("ci_me").then(function (m) {
      me = m;
      if (!me.seats || !me.seats.length) {
        header();
        setMain('<div class="panel"><h2>No seat for this email address</h2><p>' + esc(me.email) + " is signed in but holds no seat in Capture Intelligence, so nothing is shown. Ask PHLUX.</p></div>");
        return;
      }
      me.phlux = me.seats.indexOf("phlux") >= 0;
      header();
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && data) checkReading(); });
      return load(false).then(checkReading);
    });
  }).catch(fail);
})();
