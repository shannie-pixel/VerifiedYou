(function () {
  'use strict';

  const config = {
    url: window.VERIFIEDYOU_SUPABASE_URL,
    key: window.VERIFIEDYOU_SUPABASE_ANON_KEY
  };
  let client;
  let currentProfile;
  let currentAuthUser;

  function getClient() {
    if (client) return client;
    if (!window.supabase || !config.url || !config.key ||
        config.url.includes('YOUR_PROJECT_ID') ||
        config.key.includes('YOUR_SUPABASE_')) {
      throw new Error('Supabase is not configured. Update supabase-config.js with your project URL and publishable anon key.');
    }
    client = window.supabase.createClient(config.url, config.key);
    return client;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }

  function fmt(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
  }

  function ago(value) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return days + ' days ago';
  }

  function initials(value) {
    return String(value || '').trim().split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0).toUpperCase();
    }).join('') || '?';
  }

  function ico(name) {
    const paths = {
      check:'<path d="M5 12l4 4L19 6"/>',
      clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      x:'<path d="M6 6l12 12M18 6L6 18"/>',
      award:'<circle cx="12" cy="8" r="6"/><path d="M8.2 13l-1 8 4.8-3 4.8 3-1-8"/>',
      send:'<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
      share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.7 10.7l6.6-4.4m-6.6 8l6.6 4.4"/>',
      chev:'<path d="M9 18l6-6-6-6"/>',
      shield:'<path d="M12 3l8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6z"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  function mapAchievement(row) {
    return {
      id: row.id,
      t: row.title,
      c: row.category,
      s: row.status,
      by: row.verifier_name || '',
      d: row.achievement_date || '',
      n: row.description || '',
      at: row.created_at,
      f: row.proof_path || '',
      visibility: row.visibility,
      rc: row.status === 'rejected' ? row.review_note : '',
      vc: row.status === 'verified' ? row.review_note : '',
      verified_at: row.verified_at,
      institution: row.institution
    };
  }

  function meta(item) {
    return [item.c, fmt(item.d), item.by].filter(Boolean).map(esc).join(' · ');
  }

  function badge(item) {
    const labels = {verified:'Verified', pending:'Pending', rejected:'Rejected'};
    return '<span class="b ' + (item.s === 'verified' ? 'ok' : item.s === 'rejected' ? 'no' : 'wait') + '">' +
      esc(labels[item.s] || item.s) + '</span>';
  }

  function listHTML(items, empty) {
    return items.map(function (item) {
      return '<div class="item">' + badge(item) + '<h3>' + esc(item.t) + '</h3><p>' +
        esc(item.n || '') + '</p><p style="margin-top:6px"><small>' + meta(item) + '</small></p></div>';
    }).join('') || '<p class="sub">' + esc(empty) + '</p>';
  }

  function showMessage(message, type) {
    let node = document.getElementById('pageMessage');
    if (!node) {
      node = document.createElement('div');
      node.id = 'pageMessage';
      node.className = 'notice';
      node.setAttribute('role', type === 'error' ? 'alert' : 'status');
      const main = document.querySelector('main');
      if (main) main.prepend(node);
      else document.body.prepend(node);
    }
    node.className = 'notice ' + (type === 'error' ? 'error' : 'success');
    node.textContent = message;
    node.hidden = false;
  }

  function reportError(error) {
    console.error(error);
    showMessage(error && error.message ? error.message : 'Something went wrong. Please try again.', 'error');
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = label || 'Please wait…';
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    }
  }

  async function requireUser(roles) {
    const db = getClient();
    const result = await db.auth.getSession();
    if (result.error) throw result.error;
    const session = result.data.session;
    if (!session) {
      location.replace('login.html#login');
      throw new Error('Please log in to continue.');
    }
    currentAuthUser = session.user;
    const profileResult = await db.from('profiles').select('*').eq('id', session.user.id).single();
    if (profileResult.error) throw profileResult.error;
    currentProfile = profileResult.data;
    if (roles && roles.indexOf(currentProfile.role) === -1) {
      location.replace(currentProfile.role === 'lecturer' ? 'institution.html' :
        currentProfile.role === 'employer' ? 'employer.html' : 'dashboard.html');
      throw new Error('This page is not available for your account.');
    }
    if (currentProfile.role === 'lecturer') {
      const verifierResult = await db.from('institution_verifiers')
        .select('institution, active').eq('user_id', session.user.id).eq('active', true).maybeSingle();
      if (verifierResult.error) throw verifierResult.error;
      if (location.pathname.toLowerCase().endsWith('institution.html') && !verifierResult.data) {
        throw new Error('Institution review access has not been granted to this account. Ask a project administrator to add you as an institution verifier.');
      }
      currentProfile.verifier = verifierResult.data;
    }
    shell(location.pathname.split(/[\\/]/).pop(), currentProfile);
    return {db: db, authUser: session.user, profile: currentProfile};
  }

  function shell(page, profile) {
    const side = document.getElementById('side');
    if (!side || !profile) return;
    const student = profile.role === 'student';
    const institution = profile.role === 'lecturer';
    const links = student
      ? [['dashboard.html','Dashboard'],['achievements.html','Achievements'],['add-achievement.html','Add achievement'],['requests.html','Requests'],['profile.html','My profile'],['settings.html','Settings']]
      : institution
        ? [['institution.html','Verification requests']]
        : [['employer.html','Find candidates'],['employer-settings.html','Settings']];
    const activePage = (page || '').split('#')[0];
    side.innerHTML = '<a class="brand" href="index.html">' + ico('shield') + 'VerifiedYou</a>' +
      '<nav aria-label="Main">' + links.map(function (link) {
        return '<a href="' + link[0] + '" class="' + (activePage === link[0] ? 'on' : '') + '">' + esc(link[1]) + '</a>';
      }).join('') + '</nav><div class="who"><strong>' + esc(profile.full_name || profile.institution || 'Account') +
      '</strong>' + esc(profile.institution || profile.email || '') +
      '<button type="button" id="logout">Log out</button></div>';
    document.getElementById('logout').addEventListener('click', async function () {
      try {
        const {error} = await getClient().auth.signOut();
        if (error) throw error;
        location.replace('login.html#login');
      } catch (error) { reportError(error); }
    });
  }

  async function getAchievements(userId) {
    const id = userId || (currentAuthUser && currentAuthUser.id);
    if (!id) throw new Error('No signed-in user is available.');
    const {data, error} = await getClient().from('achievements').select('*')
      .eq('user_id', id).order('created_at', {ascending:false});
    if (error) throw error;
    if (!data.length) return [];
    const reviewResult = await getClient().from('achievement_reviews').select('achievement_id,note')
      .in('achievement_id',data.map(row => row.id)).order('reviewed_at',{ascending:false});
    if (reviewResult.error) throw reviewResult.error;
    const notes = new Map();
    reviewResult.data.forEach(review => { if (!notes.has(review.achievement_id)) notes.set(review.achievement_id,review.note); });
    return data.map(row => mapAchievement({...row,review_note:notes.get(row.id)}));
  }

  async function saveProfile(values) {
    if (!currentAuthUser) throw new Error('Please log in to update your profile.');
    const interests = Array.isArray(values.career_interests)
      ? values.career_interests
      : String(values.career_interests || '').split(',').map(function (item) { return item.trim(); }).filter(Boolean);
    const {data, error} = await getClient().from('profiles').update({
      full_name: values.full_name,
      institution: values.institution,
      program: values.program,
      study_year: values.study_year,
      about: values.about,
      career_interests: interests,
      profile_visibility: values.profile_visibility
    }).eq('id', currentAuthUser.id).select('*').single();
    if (error) throw error;
    currentProfile = data;
    return data;
  }

  async function saveAchievement(values, file) {
    const db = getClient();
    if (!currentAuthUser) throw new Error('Please log in to submit an achievement.');
    let proofPath = null;
    if (file) {
      if (file.size > 15 * 1024 * 1024) throw new Error('Proof files must be 15 MB or smaller.');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      proofPath = currentAuthUser.id + '/' + crypto.randomUUID() + '-' + safeName;
      const upload = await db.storage.from('proof-documents').upload(proofPath, file, {upsert:false});
      if (upload.error) throw upload.error;
    }
    const {data, error} = await db.from('achievements').insert({
      user_id: currentAuthUser.id,
      category: values.category,
      title: values.title,
      description: values.description,
      achievement_date: values.achievement_date || null,
      institution: values.institution || currentProfile.institution || '',
      verifier_name: values.verifier_name,
      proof_path: proofPath,
      visibility: values.visibility,
      status: 'pending'
    }).select('id').single();
    if (error) {
      if (proofPath) {
        const cleanup = await db.storage.from('proof-documents').remove([proofPath]);
        if (cleanup.error) console.error('Could not remove the uploaded proof after the achievement insert failed.', cleanup.error);
      }
      throw error;
    }
    return data;
  }

  async function updateAchievement(id, values, file) {
    const db = getClient();
    if (!currentAuthUser) throw new Error('Please log in to update an achievement.');
    const {data:existing,error:lookupError} = await db.from('achievements').select('proof_path,status')
      .eq('id',id).eq('user_id',currentAuthUser.id).single();
    if (lookupError) throw lookupError;
    if (existing.status === 'verified') throw new Error('Verified achievements cannot be edited.');
    let proofPath = existing.proof_path;
    let uploadedPath = null;
    if (file) {
      if (file.size > 15 * 1024 * 1024) throw new Error('Proof files must be 15 MB or smaller.');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      uploadedPath = currentAuthUser.id + '/' + crypto.randomUUID() + '-' + safeName;
      const upload = await db.storage.from('proof-documents').upload(uploadedPath,file,{upsert:false});
      if (upload.error) throw upload.error;
      proofPath = uploadedPath;
    }
    const {error} = await db.from('achievements').update({
      category:values.category,
      title:values.title,
      description:values.description,
      achievement_date:values.achievement_date || null,
      verifier_name:values.verifier_name,
      proof_path:proofPath,
      visibility:values.visibility,
      status:'pending',
      verifier_user_id:null,
      verified_at:null
    }).eq('id',id).eq('user_id',currentAuthUser.id);
    if (error) {
      if (uploadedPath) {
        const cleanup = await db.storage.from('proof-documents').remove([uploadedPath]);
        if (cleanup.error) console.error('Could not remove the replacement proof after the achievement update failed.',cleanup.error);
      }
      throw error;
    }
    if (uploadedPath && existing.proof_path) {
      const removal = await db.storage.from('proof-documents').remove([existing.proof_path]);
      if (removal.error) console.error('Could not remove the replaced proof document.',removal.error);
    }
  }

  async function deleteAchievement(id) {
    const db = getClient();
    if (!currentAuthUser) throw new Error('Please log in to delete an achievement.');
    const {data:existing,error:lookupError} = await db.from('achievements').select('proof_path,status')
      .eq('id',id).eq('user_id',currentAuthUser.id).single();
    if (lookupError) throw lookupError;
    if (existing.status === 'verified') throw new Error('Verified achievements cannot be deleted.');
    const {error} = await db.from('achievements').delete().eq('id',id).eq('user_id',currentAuthUser.id);
    if (error) throw error;
    if (existing.proof_path) {
      const removal = await db.storage.from('proof-documents').remove([existing.proof_path]);
      if (removal.error) throw removal.error;
    }
  }

  async function getSignedFile(bucket, path, expiresIn) {
    if (!path) return '';
    const {data, error} = await getClient().storage.from(bucket).createSignedUrl(path, expiresIn || 900);
    if (error) throw error;
    return data.signedUrl;
  }

  async function uploadAvatar(file) {
    if (!currentAuthUser) throw new Error('Please log in to update your profile photo.');
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Profile photos must be 5 MB or smaller.');
    const oldPath = currentProfile.avatar_path;
    const path = currentAuthUser.id + '/' + crypto.randomUUID() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const {error: uploadError} = await getClient().storage.from('profile-avatars').upload(path, file, {upsert:false});
    if (uploadError) throw uploadError;
    const {data, error} = await getClient().from('profiles').update({avatar_path:path})
      .eq('id', currentAuthUser.id).select('*').single();
    if (error) {
      const cleanup = await getClient().storage.from('profile-avatars').remove([path]);
      if (cleanup.error) console.error('Could not remove the uploaded avatar after the profile update failed.', cleanup.error);
      throw error;
    }
    currentProfile = data;
    if (oldPath) {
      const removal = await getClient().storage.from('profile-avatars').remove([oldPath]);
      if (removal.error) console.error('Could not remove the previous profile photo.', removal.error);
    }
    return getSignedFile('profile-avatars', path);
  }

  async function removeAvatar() {
    const oldPath = currentProfile && currentProfile.avatar_path;
    if (!oldPath) return;
    const {data, error} = await getClient().from('profiles').update({avatar_path:null})
      .eq('id', currentAuthUser.id).select('*').single();
    if (error) throw error;
    currentProfile = data;
    const removal = await getClient().storage.from('profile-avatars').remove([oldPath]);
    if (removal.error) throw removal.error;
  }

  function setAvatar(element, url, name) {
    element.textContent = url ? '' : initials(name);
    element.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
    element.classList.toggle('has-photo', Boolean(url));
  }

  function strength(profile) {
    const checks = [profile.full_name, profile.program, profile.institution, profile.study_year,
      profile.about, profile.career_interests && profile.career_interests.length];
    const pct = Math.round(checks.filter(Boolean).length / checks.length * 100);
    const tip = pct >= 70 ? 'Your profile has the details employers need.' : 'Add your programme, institution, and a short summary to strengthen your profile.';
    return {pct: pct, tip: tip};
  }

  async function routeForRole() {
    const db = getClient();
    const {data: sessionData, error} = await db.auth.getSession();
    if (error) throw error;
    if (!sessionData.session) return null;
    currentAuthUser = sessionData.session.user;
    const {data, error: profileError} = await db.from('profiles').select('role').eq('id', currentAuthUser.id).single();
    if (profileError) throw profileError;
    return data.role === 'lecturer' ? 'institution.html' : data.role === 'employer' ? 'employer.html' : 'dashboard.html';
  }

  window.VY = {
    getClient:getClient, requireUser:requireUser, getAchievements:getAchievements,
    saveProfile:saveProfile, saveAchievement:saveAchievement, updateAchievement:updateAchievement,
    deleteAchievement:deleteAchievement, getSignedFile:getSignedFile,
    uploadAvatar:uploadAvatar, removeAvatar:removeAvatar, setAvatar:setAvatar,
    strength:strength, routeForRole:routeForRole, showMessage:showMessage,
    reportError:reportError, setBusy:setBusy, mapAchievement:mapAchievement
  };
  window.esc = esc;
  window.fmt = fmt;
  window.ago = ago;
  window.initials = initials;
  window.ico = ico;
  window.meta = meta;
  window.badge = badge;
  window.listHTML = listHTML;
  window.user = function () { return currentProfile || {}; };
  window.staff = function () { return currentProfile || {}; };
  window.addEventListener('unhandledrejection', function (event) {
    reportError(event.reason);
  });
})();
