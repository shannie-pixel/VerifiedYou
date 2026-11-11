(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let filter = 'all', selectedId = null, requests = [], letterFilter = 'all',
    selectedLetterId = null, letterRequests = [], profile, verifier, institution;
  const label = value => value.charAt(0).toUpperCase() + value.slice(1);
  const statusOf = row => row.status === 'verified' ? 'approved' : row.status;
  const current = () => requests.find(row => row.id === selectedId);
  const currentLetter = () => letterRequests.find(row => row.id === selectedLetterId);
  const letterLabel = status => ({pending:'Pending',completed:'Completed',rejected:'Declined'})[status] || status;
  const isMissingRecommendationTable = error => error &&
    (error.code === 'PGRST205' || error.code === '42P01' ||
      /could not find the table .*recommendation_requests|relation .*recommendation_requests.* does not exist/i.test(error.message || ''));

  function reportLetterError(error) {
    if (isMissingRecommendationTable(error)) {
      $('letterSetupError').textContent =
        'Recommendation requests are not set up in this Supabase project yet. In Supabase Dashboard → SQL Editor, run supabase/migrations/20261111000000_recommendation_requests.sql, then reload this page. If you already ran it, refresh the PostgREST schema cache and reload.';
      $('letterSetupError').hidden = false;
      $('letterSummary').hidden = true;
      $('letterQueue').hidden = true;
      return;
    }
    VY.reportError(error);
  }

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

  function renderLetters() {
    const query = $('letterQ').value.toLowerCase().trim();
    const visible = letterRequests.filter(row =>
      (letterFilter === 'all' || row.status === letterFilter) &&
      ((row.student.full_name || '') + ' ' + row.purpose + ' ' + row.recipient_name).toLowerCase().includes(query));
    $('letterRows').innerHTML = visible.map(row =>
      '<tr tabindex="0" data-id="' + esc(row.id) + '" class="' + (row.id === selectedLetterId ? 'sel' : '') + '">' +
      '<td>' + esc(row.student.full_name || 'Student') + '<small>' + esc(row.recipient_name) +
      ' · ' + esc(row.purpose) + '</small></td>' +
      '<td>' + esc(fmt(row.created_at)) + '</td><td><span class="tag ' + row.status + '">' +
      esc(letterLabel(row.status)) + '</span></td></tr>').join('');
    $('letterNone').hidden = visible.length > 0;
    $('letterNone').textContent = letterRequests.length
      ? 'No recommendation requests match your search or filter.'
      : 'No recommendation requests yet for your institution.';
    ['pending','completed','rejected'].forEach(status => {
      $('letter' + label(status)).textContent = letterRequests.filter(row => row.status === status).length;
    });
    $('letterTotal').textContent = letterRequests.length;
    renderLetterDetail();
  }

  async function renderLetterDetail() {
    const row = currentLetter(), element = $('letterDetail');
    if (!row) {
      element.innerHTML = '<div class="empty">Select a recommendation request to review it.</div>';
      return;
    }
    const done = row.status !== 'pending';
    let letter = '';
    if (row.letter_path) {
      try {
        const url = await VY.getSignedFile('recommendation-letters', row.letter_path);
        letter = '<a target="_blank" rel="noopener" href="' + esc(url) + '">Open completed letter</a>';
      } catch (error) {
        letter = '<span>The completed letter could not be opened.</span>';
        VY.reportError(error);
      }
    }
    if (currentLetter() !== row) return;
    element.innerHTML = '<span class="tag ' + row.status + '">' + esc(letterLabel(row.status)) + '</span>' +
      '<h2>' + esc(row.purpose) + '</h2><small style="color:var(--muted)">' +
      esc(row.student.full_name || 'Student') + '</small>' +
      '<dl><dt>Programme</dt><dd>' + esc([row.student.program,row.student.institution].filter(Boolean).join(' · ') || 'Not provided') +
      '</dd><dt>Recipient</dt><dd>' + esc(row.recipient_name) + '</dd>' +
      '<dt>Message</dt><dd>' + esc(row.message || 'None given') + '</dd>' +
      '<dt>Needed by</dt><dd>' + esc(fmt(row.deadline) || 'No deadline provided') + '</dd>' +
      '<dt>Submitted</dt><dd>' + esc(fmt(row.created_at)) + '</dd></dl>' +
      (letter ? '<div class="doc">' + letter + '</div>' : '') +
      (row.response_note ? '<p class="msg"><b>Reviewer note:</b> ' + esc(row.response_note) + '</p>' : '') +
      (done ? '' :
        '<label for="letterNote">Note to student (required when declining)</label>' +
        '<textarea id="letterNote" maxlength="2000">' + esc(row.response_note || '') + '</textarea>' +
        '<label for="letterFile">Completed signed letter (PDF, max 10 MB)</label>' +
        '<input id="letterFile" type="file" accept="application/pdf">' +
        '<div class="acts"><button class="no" id="letterReject">Decline</button>' +
        '<button class="ok" id="letterComplete">Attach letter and complete</button></div>' +
        '<p class="msg" id="letterMsg"></p>');
    if (!done) {
      $('letterReject').onclick = () => decideLetter('rejected');
      $('letterComplete').onclick = () => decideLetter('completed');
    }
  }

  async function decideLetter(decision) {
    const row = currentLetter();
    if (!row) return;
    const note = $('letterNote').value.trim();
    const file = $('letterFile').files[0];
    if (decision === 'rejected' && !note) {
      $('letterMsg').textContent = 'Add a note explaining why the request is being declined.';
      $('letterNote').focus();
      return;
    }
    if (decision === 'completed' && (!file ||
      (file.type && file.type !== 'application/pdf') ||
      !/\.pdf$/i.test(file.name) || file.size > 10 * 1024 * 1024)) {
      $('letterMsg').textContent = 'Choose a PDF letter that is 10 MB or smaller.';
      $('letterFile').focus();
      return;
    }
    const buttons = document.querySelectorAll('#letterDetail .acts button');
    buttons.forEach(button => { button.disabled = true; });
    let letterPath = null;
    try {
      const client = VY.getClient();
      if (decision === 'completed') {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        letterPath = row.id + '/' + crypto.randomUUID() + '-' + safeName;
        const {error} = await client.storage.from('recommendation-letters')
          .upload(letterPath, file, {upsert:false, contentType:'application/pdf'});
        if (error) throw error;
      }
      const {error} = await client.rpc('review_recommendation_request', {
        request_id:row.id,
        decision,
        reviewer_note:note,
        completed_letter_path:letterPath
      });
      if (error) throw error;
    } catch (error) {
      if (letterPath) {
        try {
          const {error:cleanupError} = await VY.getClient().storage.from('recommendation-letters').remove([letterPath]);
          if (cleanupError) console.error('Could not remove the uploaded letter after the request review failed.',cleanupError);
        } catch (cleanupError) {
          console.error('Could not remove the uploaded letter after the request review failed.',cleanupError);
        }
      }
      VY.reportError(error);
      buttons.forEach(button => { button.disabled = false; });
      return;
    }
    VY.showMessage(decision === 'completed'
      ? 'Recommendation letter attached and request completed.'
      : 'Recommendation request declined.','success');
    try { await loadLetters(); }
    catch (error) { reportLetterError(error); }
  }

  async function loadLetters() {
    const {data,error} = await VY.getClient().from('recommendation_requests')
      .select('*')
      .eq('institution',institution).order('created_at',{ascending:false});
    if (error) throw error;
    letterRequests = await Promise.all(data.map(async row => {
      const {data:student,error:studentError} = await VY.getClient()
        .rpc('get_recommendation_request_student',{request_id:row.id});
      if (studentError) throw studentError;
      return {...row,student};
    }));
    if (!currentLetter() && letterRequests.length) {
      const pending = letterRequests.find(row => row.status === 'pending');
      selectedLetterId = (pending || letterRequests[0]).id;
    } else if (currentLetter()) {
      selectedLetterId = currentLetter().id;
    }
    renderLetters();
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
    const activeLink = location.hash === '#recommendations' ? '#recommendations'
      : value === 'history' || location.hash === '#history' ? '#history' : 'institution.html';
    document.querySelectorAll('nav a').forEach(link =>
      link.classList.toggle('on',link.getAttribute('href') === activeLink));
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
  $('letterRows').onclick = event => {
    const row = event.target.closest('tr');
    if (row) { selectedLetterId = row.dataset.id; renderLetters(); }
  };
  $('letterRows').onkeydown = event => {
    const row = event.target.closest('tr');
    if (row && event.key === 'Enter') { selectedLetterId = row.dataset.id; renderLetters(); }
  };
  $('letterQ').oninput = renderLetters;
  document.querySelectorAll('[data-letter-filter]').forEach(button => {
    button.onclick = () => {
      letterFilter = button.dataset.letterFilter;
      document.querySelectorAll('[data-letter-filter]').forEach(item =>
        item.setAttribute('aria-pressed',String(item === button)));
      renderLetters();
    };
  });

  (async function init() {
    try {
      const access = await VY.requireUser(['lecturer']);
      profile = access.profile;
      verifier = profile.verifier;
      institution = verifier ? verifier.institution : profile.institution;
      if (!institution) throw new Error('Add your institution to your lecturer profile to review recommendation requests.');
      $('instName').textContent = institution;
      if (verifier) {
        await load();
      } else {
        $('pageTitle').textContent = 'Recommendation requests';
        $('pageIntro').textContent = 'Requests sent directly to you by students at your institution.';
        $('achievementSummary').hidden = true;
        $('achievementQueue').hidden = true;
      }
      await loadLetters();
      setFilter(location.hash === '#history' ? 'history' : 'all');
    } catch (error) { reportLetterError(error); }
  })();
})();
