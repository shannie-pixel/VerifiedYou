(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let candidates = [], shortlisted = new Set(), notes = new Map(), tab = 'all', selectedId = null, employerId;

  function verifiedCount(candidate) {
    return candidate.achievements.filter(item => item.s === 'verified').length;
  }

  function filteredAchievements(candidate) {
    return candidate.achievements.filter(item =>
      (!$('vo').checked || item.s === 'verified') &&
      (!$('cat').value || item.c === $('cat').value));
  }

  function visibleCandidates() {
    const query = $('q').value.trim().toLowerCase();
    return candidates.filter(candidate => {
      if (tab === 'short' && !shortlisted.has(candidate.id)) return false;
      if ($('vo').checked && !verifiedCount(candidate)) return false;
      if ($('cat').value && !filteredAchievements(candidate).length) return false;
      if ($('ins').value && candidate.institution !== $('ins').value) return false;
      return !query || [
        candidate.full_name, candidate.program, candidate.institution,
        candidate.study_year, candidate.career_interests.join(' '),
        candidate.achievements.map(item => item.t).join(' ')
      ].join(' ').toLowerCase().includes(query);
    }).sort($('srt').value === 'name'
      ? (a,b) => a.full_name.localeCompare(b.full_name)
      : (a,b) => verifiedCount(b) - verifiedCount(a));
  }

  function renderStats() {
    $('n1').textContent = candidates.filter(candidate => verifiedCount(candidate) > 0).length;
    $('n2').textContent = shortlisted.size;
    $('sc').textContent = shortlisted.size;
    $('n3').textContent = new Set(candidates.filter(candidate => verifiedCount(candidate))
      .map(candidate => candidate.institution).filter(Boolean)).size;
  }

  function renderList() {
    const results = visibleCandidates();
    $('list').innerHTML = results.map(candidate => {
      const count = verifiedCount(candidate), isShortlisted = shortlisted.has(candidate.id);
      const categories = [...new Set(candidate.achievements.filter(item => item.s === 'verified')
        .map(item => item.c))].slice(0,3);
      const avatar = '<span class="av js-photo" data-name="' + esc(candidate.full_name) +
        '" data-path="' + esc(candidate.avatar_path || '') + '">' + esc(initials(candidate.full_name)) + '</span>';
      return '<div class="crow' + (candidate.id === selectedId ? ' sel' : '') + '" data-id="' + esc(candidate.id) + '" tabindex="0">' +
        avatar + '<div class="mid"><b>' + esc(candidate.full_name || 'Student') + '</b><small>' +
        esc([candidate.program,candidate.institution].filter(Boolean).join(' · ')) + '</small><div class="chips" style="margin-top:6px">' +
        categories.map(category => '<span class="chip">' + esc(category) + '</span>').join('') + '</div></div>' +
        '<span class="b ' + (count ? 'ok' : 'wait') + '">' + count + ' verified</span>' +
        '<button class="star' + (isShortlisted ? ' on' : '') + '" data-shortlist="' + esc(candidate.id) +
        '" aria-pressed="' + isShortlisted + '" aria-label="Shortlist ' + esc(candidate.full_name) + '">' +
        (isShortlisted ? '★' : '☆') + '</button></div>';
    }).join('') || '<p class="sub">' + (tab === 'short'
      ? 'No one shortlisted yet. Select the star on a candidate to save them here.'
      : 'No candidates match your filters.') + '</p>';
    loadVisibleAvatars();
  }

  async function loadVisibleAvatars() {
    const photos = document.querySelectorAll('#list .js-photo[data-path]:not([data-loaded])');
    for (const element of photos) {
      element.dataset.loaded = 'true';
      try {
        const url = await VY.getSignedFile('profile-avatars', element.dataset.path);
        VY.setAvatar(element,url,element.dataset.name);
      } catch (error) { console.error('Could not load a public profile photo.',error); }
    }
  }

  async function showCandidate(id) {
    selectedId = id;
    renderList();
    const candidate = candidates.find(item => item.id === id);
    if (!candidate) return;
    const isShortlisted = shortlisted.has(id), achievements = filteredAchievements(candidate);
    let avatar = '<span class="av">' + esc(initials(candidate.full_name)) + '</span>';
    if (candidate.avatar_path) {
      try {
        const url = await VY.getSignedFile('profile-avatars',candidate.avatar_path);
        avatar = '<span class="av has-photo" style="background-image:url(&quot;' + esc(url) + '&quot;)"></span>';
      } catch (error) { console.error('Could not load a public profile photo.',error); }
    }
    if (selectedId !== id) return;
    $('detail').innerHTML = '<div class="head">' + avatar + '<div><h2>' + esc(candidate.full_name || 'Student') +
      '</h2><p class="sub">' + esc([candidate.program,candidate.institution,candidate.study_year].filter(Boolean).join(' · ')) +
      '</p></div></div><h2 style="margin-top:16px">About</h2><p style="font-size:.88rem">' +
      esc(candidate.about || 'No summary provided.') + '</p><h2 style="margin:16px 0 8px">' +
      ($('vo').checked ? 'Verified achievements' : 'Achievements') + '</h2>' +
      (achievements.map(item => '<div class="item">' + badge(item) + '<h3>' + esc(item.t) + '</h3><p>' + meta(item) + '</p></div>').join('') ||
        '<p class="sub">None to show with the current filters.</p>') +
      '<div class="f no-print" style="margin-top:12px"><label for="nt">Your private note</label><textarea id="nt" placeholder="Only you can see this">' +
      esc(notes.get(id) || '') + '</textarea></div><div class="acts no-print"><button class="btn' +
      (isShortlisted ? ' o' : '') + '" id="sl">' + (isShortlisted ? '★ Shortlisted' : '☆ Shortlist') +
      '</button><button class="btn o" id="print">Print / save PDF</button></div>';
    $('nt').onchange = async function () {
      const note = this.value;
      try {
        const {error} = await VY.getClient().from('employer_notes').upsert({
          employer_id:employerId,student_id:id,note:note,updated_at:new Date().toISOString()
        },{onConflict:'employer_id,student_id'});
        if (error) throw error;
        notes.set(id,note);
      } catch (error) { VY.reportError(error); }
    };
    $('sl').onclick = () => toggleShortlist(id);
    $('print').onclick = () => window.print();
  }

  async function toggleShortlist(id) {
    const isAdded = !shortlisted.has(id);
    const request = isAdded
      ? VY.getClient().from('employer_shortlists').insert({employer_id:employerId,student_id:id})
      : VY.getClient().from('employer_shortlists').delete().eq('employer_id',employerId).eq('student_id',id);
    const {error} = await request;
    if (error) { VY.reportError(error); return; }
    if (isAdded) shortlisted.add(id); else shortlisted.delete(id);
    renderStats();
    if (tab === 'short' && !isAdded) {
      selectedId = null;
      $('detail').innerHTML = '<p class="sub">Select a candidate to see their verified record.</p>';
      renderList();
    } else await showCandidate(id);
  }

  function setTab(value) {
    tab = value;
    document.querySelectorAll('#tabs button').forEach(button => button.classList.toggle('on',button.dataset.t === value));
    renderList();
  }

  async function init() {
    const {db,authUser} = await VY.requireUser(['employer']);
    employerId = authUser.id;
    const [profileResult,shortlistResult,notesResult] = await Promise.all([
      db.from('profiles').select('id,full_name,institution,program,study_year,about,career_interests,avatar_path')
        .eq('role','student').eq('profile_visibility','public').order('full_name'),
      db.from('employer_shortlists').select('student_id').eq('employer_id',employerId),
      db.from('employer_notes').select('student_id,note').eq('employer_id',employerId)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (shortlistResult.error) throw shortlistResult.error;
    if (notesResult.error) throw notesResult.error;
    const profiles = profileResult.data || [], ids = profiles.map(item => item.id);
    shortlisted = new Set((shortlistResult.data || []).map(item => item.student_id));
    notes = new Map((notesResult.data || []).map(item => [item.student_id,item.note]));
    let achievementRows = [];
    if (ids.length) {
      const result = await db.from('achievements').select('*').in('user_id',ids).eq('status','verified');
      if (result.error) throw result.error;
      achievementRows = result.data;
    }
    candidates = profiles.map(profile => ({
      ...profile,
      career_interests:profile.career_interests || [],
      achievements:achievementRows.filter(item => item.user_id === profile.id).map(VY.mapAchievement)
    }));
    $('ins').innerHTML = '<option value="">All institutions</option>' +
      [...new Set(candidates.map(candidate => candidate.institution).filter(Boolean))].sort()
        .map(institution => '<option value="' + esc(institution) + '">' + esc(institution) + '</option>').join('');
    [['i1','check'],['i2','award'],['i3','shield']].forEach(pair => $(pair[0]).innerHTML = ico(pair[1]));
    ['q','cat','ins','srt','vo'].forEach(id => {
      $(id).addEventListener('input',renderList);
      $(id).addEventListener('change',renderList);
    });
    $('tabs').onclick = event => {
      const button = event.target.closest('button');
      if (button) { location.hash = button.dataset.t === 'short' ? '#shortlist' : '#all'; }
    };
    window.onhashchange = () => setTab(location.hash === '#shortlist' ? 'short' : 'all');
    $('list').onclick = event => {
      const star = event.target.closest('button[data-shortlist]');
      if (star) { event.stopPropagation();toggleShortlist(star.dataset.shortlist);return; }
      const row = event.target.closest('.crow');
      if (row) showCandidate(row.dataset.id);
    };
    $('list').onkeydown = event => {
      if (event.key === 'Enter' && event.target.classList.contains('crow')) showCandidate(event.target.dataset.id);
    };
    renderStats();
    setTab(location.hash === '#shortlist' ? 'short' : 'all');
  }

  init().catch(VY.reportError);
})();
