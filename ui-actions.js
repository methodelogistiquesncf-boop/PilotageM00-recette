// ui-actions.js — onglet "Actions" : liste des remarques envoyées depuis le tableau
// Supermarché (bouton "→" sur les cellules score / lignes de remarque), avec
// statut Fait / Pas fait, responsable, échéance, filtres et export CSV.
// Les actions peuvent aussi être créées manuellement via "+ Ajouter une action".
//
// Une action est une COPIE FIGÉE de la remarque au moment de l'envoi (Engin, Section,
// Date, Texte). Elle vit indépendamment des cellules du tableau : elle ne
// disparaît donc pas quand la case d'origine est réutilisée le lendemain.

import { state, markDirty, todayISO, isoToDisplay, showConfirm, autoResize } from './state.js';
import { saveFirebase } from './firebase.js';
import { ensureAgentEmailsLoaded, buildResponsableCell } from './responsable-field.js';

// Recalcule la hauteur d'une textarea auto-extensible dès qu'elle est
// effectivement dans le DOM (layout final connu) et à chaque fois que la
// largeur de sa cellule change ensuite (redimensionnement de la fenêtre...).
function observeCommentSize(td, textarea) {
  requestAnimationFrame(function () { requestAnimationFrame(function () { autoResize(textarea); }); });
  if (typeof ResizeObserver === 'undefined') return;
  var lastWidth = null;
  var ro = new ResizeObserver(function (entries) {
    var w = entries[0].contentRect.width;
    if (w !== lastWidth) { lastWidth = w; autoResize(textarea); }
  });
  ro.observe(td);
}

// Filtres de vue (état d'affichage uniquement, pas persisté)
var currentFilterPoste = '';
var currentFilterSection = '';

function makeActionItem(data) {
  return {
    id: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    engin: data.engin || '',
    poste: data.poste || '',
    section: data.section || '',
    date: data.date || '',
    kit: data.kit || '',
    symbole: data.symbole || '',
    commentaire: data.commentaire || '',
    responsable: '',
    echeance: '',
    done: false,
    manual: !!data.manual,
    createdAt: new Date().toISOString(),
    doneAt: ''
  };
}

// Appelée depuis ui-supermarche.js par les boutons "→" (par ligne ou global cellule).
export function sendToAction(data) {
  if ((!data.kit || !data.kit.trim()) && (!data.symbole || !data.symbole.trim())) return;

  // Anti-doublon : si une action identique et non faite existe déjà, on ne
  // recrée pas de ligne (utile si on reclique par erreur).
  var doublon = state.actions.find(function (a) {
    return !a.done && a.engin === data.engin && a.section === data.section &&
      a.date === data.date && a.kit === data.kit && a.symbole === data.symbole;
  });
  if (doublon) { buildActions(); return; }

  state.actions.push(makeActionItem(data));
  saveFirebase();
  buildActions();
  markDirty();
}

// Appelée par le bouton "+ Ajouter une action" : crée une ligne vide, entièrement
// éditable directement dans le tableau (contrairement aux actions envoyées depuis
// le Supermarché, ici tous les champs sont saisis à la main).
export function addManualAction() {
  var item = makeActionItem({ date: isoToDisplay(todayISO()), manual: true });
  state.actions.unshift(item);
  buildActions();
  markDirty();
}

export function toggleActionDone(id) {
  var a = state.actions.find(function (x) { return x.id === id; });
  if (!a) return;
  a.done = !a.done;
  a.doneAt = a.done ? new Date().toISOString() : '';
  saveFirebase();
  buildActions();
  markDirty();
}

export async function deleteAction(id) {
  var ok = await showConfirm('Cette action sera définitivement supprimée. Cette opération est irréversible.', { title: 'Supprimer cette action ?' });
  if (!ok) return;
  state.actions = state.actions.filter(function (a) { return a.id !== id; });
  saveFirebase();
  buildActions();
  markDirty();
}

export function toggleShowDoneActions() {
  state.showDoneActions = !state.showDoneActions;
  var btn = document.getElementById('btnToggleActionsDone');
  btn.textContent = state.showDoneActions ? '👁 Masquer les faites' : '👁 Afficher les faites';
  btn.classList.toggle('btn-primary', state.showDoneActions);
  btn.classList.toggle('btn-ghost', !state.showDoneActions);
  buildActions();
}

function updateActionsCount() {
  var total = state.actions.filter(function (a) { return !a.done; }).length;
  var badge = document.getElementById('actionsCount');
  if (!badge) return;
  if (total > 0) { badge.style.display = 'inline-block'; badge.textContent = total; }
  else { badge.style.display = 'none'; }
}

// ─── Filtres (poste / section) ─────────────────────────────────────────────
function fillSelect(id, values, allLabel, current) {
  var sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = '';
  var optAll = document.createElement('option'); optAll.value = ''; optAll.textContent = allLabel;
  sel.appendChild(optAll);
  values.forEach(function (v) {
    var o = document.createElement('option'); o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
  sel.value = values.indexOf(current) >= 0 ? current : '';
}

function setupFilters() {
  var postes = Array.from(new Set(state.actions.map(function (a) { return a.poste; }).filter(Boolean))).sort();
  var sections = Array.from(new Set(state.actions.map(function (a) { return a.section; }).filter(Boolean))).sort();
  fillSelect('actionsFilterPoste', postes, 'Tous les postes', currentFilterPoste);
  fillSelect('actionsFilterSection', sections, 'Toutes sections', currentFilterSection);

  var selPoste = document.getElementById('actionsFilterPoste');
  var selSection = document.getElementById('actionsFilterSection');
  if (selPoste) selPoste.onchange = function () { currentFilterPoste = selPoste.value; buildActions(); };
  if (selSection) selSection.onchange = function () { currentFilterSection = selSection.value; buildActions(); };
}

export function buildActions() {
  updateActionsCount();
  setupFilters();
  ensureAgentEmailsLoaded();

  var wrap = document.getElementById('actionsTableWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  var list = state.actions.slice();
  if (currentFilterPoste) list = list.filter(function (a) { return a.poste === currentFilterPoste; });
  if (currentFilterSection) list = list.filter(function (a) { return a.section === currentFilterSection; });

  list.sort(function (a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    var d = (b.date || '').localeCompare(a.date || '');
    if (d !== 0) return d;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  if (!state.showDoneActions) list = list.filter(function (a) { return !a.done; });

  if (list.length === 0) {
    var msg = state.actions.length === 0
      ? 'Aucune action pour le moment. Utilise le bouton « → » sur une remarque du tableau Supermarché, ou « + Ajouter une action » pour en créer une manuellement.'
      : (currentFilterPoste || currentFilterSection)
        ? 'Aucune action ne correspond aux filtres sélectionnés.'
        : 'Toutes les actions sont faites. « Afficher les faites » pour les revoir.';
    var emptyDiv = document.createElement('div');
    emptyDiv.className = 'manquants-empty';
    emptyDiv.textContent = msg;
    wrap.appendChild(emptyDiv);
    return;
  }

  var table = document.createElement('table');
  table.className = 'actions-table';

  // 🔑 Largeurs de colonnes optimisées
  var colgroup = document.createElement('colgroup');
  colgroup.innerHTML =
    '<col style="width:7%">'  +  // Engin
    '<col style="width:8%">'  +  // Poste
    '<col style="width:10%">' +  // Section
    '<col style="width:5%">'  +  // Date
    '<col style="width:12%">' +  // KIT
    '<col style="width:12%">' +  // SYMBOLE
    '<col style="width:18%">' +  // Commentaire
    '<col style="width:10%">' +  // Responsable
    '<col style="width:10%">' +  // Échéance
    '<col style="width:5%">'  +  // Fait
    '<col style="width:3%">';    // ✕
  table.appendChild(colgroup);

  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Engin</th><th>Poste</th><th>Section</th><th>Date</th>' +
    '<th>KIT</th><th>SYMBOLE</th><th>Commentaire</th><th>Responsable</th><th>Échéance</th><th>Fait</th><th></th></tr>';
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  list.forEach(function (a) { tbody.appendChild(buildActionRow(a)); });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function textInputCell(a, field, placeholder, className, lockableIfAuto) {
  var td = document.createElement('td');
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.className = className || 'action-input';
  if (placeholder) inp.placeholder = placeholder;
  inp.value = a[field] || '';
  var locked = lockableIfAuto && !a.manual;
  inp.disabled = !!a.done || locked;
  if (locked) inp.title = 'Rempli automatiquement depuis le Supermarché — non modifiable';
  inp.oninput = function () { a[field] = inp.value; markDirty(); };
  td.appendChild(inp);
  return td;
}

// Variante "textarea" auto-extensible (utilisée pour Action / Commentaire) :
// le texte revient à la ligne au lieu de déborder, et le champ grandit
// verticalement pour rester lisible (même principe que .comment-area
// dans l'onglet Rassemblement).
function textareaCell(a, field, placeholder, className, lockableIfAuto) {
  var td = document.createElement('td');
  var ta = document.createElement('textarea');
  ta.className = className || 'action-input';
  ta.rows = 1;
  if (placeholder) ta.placeholder = placeholder;
  ta.value = a[field] || '';
  var locked = lockableIfAuto && !a.manual;
  ta.disabled = !!a.done || locked;
  if (locked) ta.title = 'Rempli automatiquement depuis le Supermarché — non modifiable';
  ta.oninput = function () { a[field] = ta.value; autoResize(ta); markDirty(); };
  td.appendChild(ta);
  observeCommentSize(td, ta);
  return td;
}

// Champ "Responsable" : saisie libre + menu déroulant custom stylé (rôles,

function buildActionRow(a) {
  var tr = document.createElement('tr');
  var isOverdue = !a.done && a.echeance && a.echeance < todayISO();
  if (a.done) tr.className = 'action-done';
  else if (isOverdue) tr.className = 'action-overdue';

  tr.appendChild(textInputCell(a, 'engin', 'Engin...', null, true));
  tr.appendChild(textInputCell(a, 'poste', 'Poste...', null, true));
  tr.appendChild(textInputCell(a, 'section', 'Section...', null, true));

  tr.appendChild(textInputCell(a, 'date', 'jj/mm...', null, true));
  tr.appendChild(textInputCell(a, 'kit', 'KIT...', 'action-input action-kit-input', true));
  tr.appendChild(textareaCell(a, 'symbole', 'SYMBOLE...', 'action-input action-symbole-input', true));
  tr.appendChild(textareaCell(a, 'commentaire', 'Commentaire...'));

  tr.appendChild(buildResponsableCell(a, 'responsable', !!a.done));

  var tdEch = document.createElement('td');
  var echInput = document.createElement('input');
  echInput.type = 'date'; echInput.className = 'action-input action-date-input';
  echInput.value = a.echeance || '';
  echInput.disabled = !!a.done;
  echInput.onchange = function () { a.echeance = echInput.value; markDirty(); buildActions(); };
  tdEch.appendChild(echInput);
  if (isOverdue) {
    var warn = document.createElement('span');
    warn.className = 'action-overdue-tag';
    warn.textContent = 'En retard';
    tdEch.appendChild(warn);
  }
  tr.appendChild(tdEch);

  var tdDone = document.createElement('td'); tdDone.className = 'action-done-cell';
  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'action-checkbox';
  checkbox.checked = !!a.done;
  checkbox.title = a.done ? 'Marquer comme non fait' : 'Marquer comme fait';
  checkbox.onchange = function () { toggleActionDone(a.id); };
  tdDone.appendChild(checkbox);
  tr.appendChild(tdDone);

  var tdDel = document.createElement('td'); tdDel.style.textAlign = 'center';
  var delBtn = document.createElement('button');
  delBtn.className = 'actions-del-btn';
  delBtn.textContent = '✕';
  delBtn.title = 'Supprimer';
  delBtn.onclick = function () { deleteAction(a.id); };
  tdDel.appendChild(delBtn);
  tr.appendChild(tdDel);

  return tr;
}

// ─── Export CSV (nouvelle base : KIT / SYMBOLE + colonnes complètes) ──────
export function exportActionsCSV() {
  function fmtD(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }
  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  var today = todayISO();
  var list = state.actions.slice();
  list.sort(function (a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    var d = (b.date || '').localeCompare(a.date || '');
    if (d !== 0) return d;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  var rows = [['Engin', 'Poste', 'Section', 'Date', 'KIT', 'SYMBOLE', 'Commentaire',
               'Responsable', 'Échéance', 'Statut', 'Créée le', 'Faite le']];
  list.forEach(function (a) {
    var statut = a.done ? 'Fait' : ((a.echeance && a.echeance < today) ? 'En retard' : 'À faire');
    rows.push([
      a.engin || '', a.poste || '', a.section || '', a.date || '',
      a.kit || '', a.symbole || '', a.commentaire || '', a.responsable || '',
      fmtD(a.echeance), statut, fmtDT(a.createdAt), fmtDT(a.doneAt)
    ]);
  });

  var csv = '\ufeff' + rows.map(function (r) {
    return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';');
  }).join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'actions_' + (document.getElementById('dateJour').value || 'export') + '.csv';
  link.click();
  URL.revokeObjectURL(url);
}
