(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let filter = 'all', selectedId = null, requests = [], profile, verifier;
  const label = value => value.charAt(0).toUpperCase() + value.slice(1);
  const statusOf = row => row.status === 'verified' ? 'approved' : row.status;
  const current = () => requests.find(row => row.id === selectedId);

  function render() {
    const query = $('q').value.toLowerCase().trim();
    const visible = requests.filter(row => {
      const state = statusOf(row);
      return (filter === 'all' || state === filter || (filter === 'history' && state !== 'pending')) &&
        (row.student.full_name + ' ' + row.title + ' ' + row.category).toLowerCase().includes(query);
    });
    $('rows').innerHTML = visible.map(row => {
      const state = statusOf(row);
      return '<tr tabindex="0" data-id="' + esc(row.id) + '" class="' + (row.id === selectedId ? 'sel' : '') + '">' +
        '<td>' + esc(row.title) + '<small>' + esc(row.student.full_name || 'Student') + ' · ' + esc(row.category) + '</small></td>' +
        '<td>' + esc(fmt(row.created_at)) + '</td><td><span class="tag ' + state + '">' + label(state) + '</span></td></tr>';
    }).join('');
    $('none').hidden = visible.length > 0;
    $('none').textContent = requests.length ? 'No requests match. Try a different search or filter.' : 'No requests yet for your institution.';
    ['pending','approved','rejected'].forEach(state => {
      $('s' + label(state)).textContent = requests.filter(row => statusOf(row) === state).length;
    });
    $('sTotal').textContent = requests.length;
    renderDetail();
  }

  async function renderDetail() {
    const row = current(), element = $('detail');
    if (!row) {
      element.innerHTML = '<div class="empty">Select a request to review it.</div>';
      return;
    }
    const state = statusOf(row), done = state !== 'pending';
    let proof = '';
    try {
      if (row.proof_path) {
        const url = await VY.getSignedFile('proof-documents', row.proof_path);
        proof = '<a target="_blank" rel="noopener" href="' + esc(url) + '">Open submitted proof</a>';
      }
    } catch (error) { proof = '<span>Proof file could not be opened.</span>'; console.error(error); }
    if (current() !== row) return;
    element.innerHTML = '<span class="tag ' + state + '">' + label(state) + '</span><h2>' + esc(row.title) + '</h2>' +
      '<small style="color:var(--muted)">' + esc(row.student.full_name || 'Student') + '</small>' +
      '<dl><dt>Programme</dt><dd>' + esc([row.student.program,row.student.institution].filter(Boolean).join(' · ') || 'Not provided') +
      '</dd><dt>Category</dt><dd>' + esc(row.category) + '</dd><dt>Details</dt><dd>' + esc(row.description || 'None given') +
      '</dd><dt>Submitted</dt><dd>' + esc(fmt(row.created_at)) + '</dd></dl>' +
      '<div class="doc">' + (proof || 'No proof attached') + '</div>' +
      '<label for="note" style="display:block;margin-top:14px;font-size:14px">Note to student (required if rejecting)</label>' +
      '<textarea id="note"' + (done ? ' disabled' : '') + '>' + esc(row.reviewer_note || '') + '</textarea>' +
      '<div class="acts"><button class="no" id="rej"' + (done ? ' disabled' : '') + '>Reject</button>' +
      '<button class="ok" id="app"' + (done ? ' disabled' : '') + '>Approve</button></div>' +
      '<p class="msg" id="msg">' + (done ? 'This request has been ' + state + '.' : '') + '</p>';
    if (!done) {
      $('app').onclick = () => decide('verified');
      $('rej').onclick = () => decide('rejected');
    }
  }

  async function decide(status) {
    const row = current(), note = $('note').value.trim();
    if (!row) return;
    if (status === 'rejected' && !note) {
      $('msg').textContent = 'Add a note explaining the rejection.';
      $('note').focus();
      return;
    }
    const buttons = document.querySelectorAll('#detail .acts button');
    buttons.forEach(button => { button.disabled = true; });
    try {
      const {error} = await VY.getClient().rpc('review_achievement',{
        achievement_id:row.id,decision:status,reviewer_note:note
      });
      if (error) throw error;
      VY.showMessage('Request ' + (status === 'verified' ? 'approved' : 'rejected') + '.','success');
      await load();
    } catch (error) {
      VY.reportError(error);
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  async function load() {
    const {data,error} = await VY.getClient().from('achievements')
      .select('*, student:profiles!achievements_user_id_fkey(full_name,program,institution)')
      .eq('institution',verifier.institution).order('created_at',{ascending:false});
    if (error) throw error;
    if (data.length) {
      const reviewResult = await VY.getClient().from('achievement_reviews')
        .select('achievement_id,note').in('achievement_id',data.map(row => row.id))
        .order('reviewed_at',{ascending:false});
      if (reviewResult.error) throw reviewResult.error;
      const notes = new Map();
      reviewResult.data.forEach(review => { if (!notes.has(review.achievement_id)) notes.set(review.achievement_id,review.note); });
      requests = data.map(row => ({...row,reviewer_note:notes.get(row.id) || ''}));
    } else requests = [];
    if (!current() && requests.length) {
      const pending = requests.find(row => row.status === 'pending');
      selectedId = (pending || requests[0]).id;
    } else if (current()) {
      selectedId = current().id;
    }
    render();
  }

  function setFilter(value) {
    filter = value;
    document.querySelectorAll('.chip').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.f === value)));
    document.querySelectorAll('nav a').forEach(link => link.classList.toggle('on',
      (value === 'history') === (link.getAttribute('href') === '#history')));
    render();
  }

  $('rows').onclick = event => {
    const row = event.target.closest('tr');
    if (row) { selectedId = row.dataset.id; render(); }
  };
  $('rows').onkeydown = event => {
    const row = event.target.closest('tr');
    if (row && event.key === 'Enter') { selectedId = row.dataset.id; render(); }
  };
  $('q').oninput = render;
  document.querySelectorAll('.chip').forEach(button => { button.onclick = () => setFilter(button.dataset.f); });
  window.onhashchange = () => setFilter(location.hash === '#history' ? 'history' : 'all');

  (async function init() {
    try {
      const access = await VY.requireUser(['lecturer']);
      profile = access.profile;
      verifier = profile.verifier;
      if (!verifier) throw new Error('No active institution verifier assignment was found.');
      $('instName').textContent = verifier.institution;
      await load();
      setFilter(location.hash === '#history' ? 'history' : 'all');
    } catch (error) { VY.reportError(error); }
  })();
})();
