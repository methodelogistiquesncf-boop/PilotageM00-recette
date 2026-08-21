// pointage.js — Page Pointage : tableau avec dates/engins du Supermarché
import { state, markDirty, todayISO } from './state.js';
import { initAuth, doLogout, saveFirebase, getDb } from './firebase.js';

window.doLogout = doLogout;
window.saveFirebase = saveFirebase;

var pointageData = {};

function currentMonthKey() {
  var v = document.getElementById('dateJour').value;
  return (v || new Date().toISOString().slice(0, 10)).slice(0, 7);
}

async function loadPointage() {
  var db = getDb();
  if (!db) return;
  var key = currentMonthKey();
  var doc = await db.collection('pointage').doc(key).get();
  if (doc.exists) {
    pointageData = doc.data() || {};
  } else {
    pointageData = {};
  }
  buildTable();
}

function buildTable() {
  var thead = document.getElementById('pointageThead');
  var tbody = document.getElementById('pointageTbody');
  if (!thead || !tbody) return;

  // Récupérer les dates du Supermarché (state.supermarche)
  var dates = [];
  var dateSet = {};
  
  // Parcourir les stations pour extraire les dates uniques
  if (state.supermarche) {
    state.supermarche.forEach(function(station) {
      if (station.cols) {
        station.cols.forEach(function(col) {
          if (col.date && !dateSet[col.date]) {
            dateSet[col.date] = true;
            dates.push({ date: col.date, label: col.j || '' });
          }
        });
      }
    });
  }
  
  // Trier les dates
  dates.sort(function(a, b) { return a.date.localeCompare(b.date); });

  // Construire l'en-tête
  var headerRow = '<tr><th>Station / Engin</th>';
  dates.forEach(function(d) {
    headerRow += '<th>' + (d.label || d.date.slice(8,10) + '/' + d.date.slice(5,7)) + '</th>';
  });
  headerRow += '</tr>';
  thead.innerHTML = headerRow;

  // Construire le corps du tableau
  tbody.innerHTML = '';
  
  // Stations fixes (comme dans le Supermarché)
  var stations = [
    { name: 'Station sous-caisse', engins: ['Engin 1', 'Engin 2'] },
    { name: 'Station Terre-plein', engins: ['Engin 1', 'Engin 2'] },
    { name: 'Station Toiture', engins: ['Engin 1', 'Engin 2'] }
  ];

  stations.forEach(function(station) {
    // Ligne d'en-tête de station
    var trStation = document.createElement('tr');
    trStation.innerHTML = '<td class="station-header" colspan="' + (dates.length + 1) + '">' + station.name + '</td>';
    tbody.appendChild(trStation);

    // Lignes des engins
    station.engins.forEach(function(engin) {
      var tr = document.createElement('tr');
      var keyBase = station.name + '|' + engin;
      
      var html = '<td class="engin-label">' + engin + '</td>';
      dates.forEach(function(d) {
        var cellKey = d.date + '|' + keyBase;
        var val = pointageData[cellKey] || '';
        var circleClass = '';
        if (val === 'green') circleClass = 'green';
        else if (val === 'red') circleClass = 'red';
        else if (val === 'orange') circleClass = 'orange';
        
        html += '<td><span class="pointage-circle ' + circleClass + '" data-key="' + cellKey + '" onclick="toggleCircle(this)"></span></td>';
      });
      
      tr.innerHTML = html;
      tbody.appendChild(tr);
    });
  });
}

window.toggleCircle = function(el) {
  var key = el.getAttribute('data-key');
  var current = pointageData[key] || '';
  
  // Cycle: vide -> green -> red -> orange -> vide
  var next = '';
  if (current === '') next = 'green';
  else if (current === 'green') next = 'red';
  else if (current === 'red') next = 'orange';
  else if (current === 'orange') next = '';
  
  if (next === '') {
    delete pointageData[key];
  } else {
    pointageData[key] = next;
  }
  
  el.className = 'pointage-circle ' + next;
  markDirty();
};

window.savePointage = function() {
  var db = getDb();
  if (!db) return;
  
  var key = currentMonthKey();
  db.collection('pointage').doc(key).set(pointageData, { merge: true })
    .then(function() {
      console.log('Pointage sauvegardé');
      var status = document.getElementById('fbStatus');
      if (status) {
        status.textContent = '✓ Sauvegardé';
        status.className = 'ok';
        setTimeout(function() { status.textContent = ' Connexion...'; status.className = 'sync'; }, 2000);
      }
    })
    .catch(function(e) {
      console.error('Erreur sauvegarde pointage:', e);
    });
};

window.exportPointageCSV = function() {
  var rows = [['Station', 'Engin']];
  var dates = [];
  
  if (state.supermarche) {
    state.supermarche.forEach(function(station) {
      if (station.cols) {
        station.cols.forEach(function(col) {
          if (col.date && dates.indexOf(col.date) === -1) {
            dates.push(col.date);
          }
        });
      }
    });
  }
  
  dates.sort();
  rows[0] = rows[0].concat(dates.map(function(d) { return d.slice(8,10) + '/' + d.slice(5,7); }));
  
  var stations = [
    { name: 'Station sous-caisse', engins: ['Engin 1', 'Engin 2'] },
    { name: 'Station Terre-plein', engins: ['Engin 1', 'Engin 2'] },
    { name: 'Station Toiture', engins: ['Engin 1', 'Engin 2'] }
  ];
  
  stations.forEach(function(station) {
    station.engins.forEach(function(engin) {
      var row = [station.name, engin];
      dates.forEach(function(date) {
        var key = date + '|' + station.name + '|' + engin;
        var val = pointageData[key] || '';
        row.push(val);
      });
      rows.push(row);
    });
  });
  
  var csv = '\ufeff' + rows.map(function(r) {
    return r.map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';');
  }).join('\n');
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'pointage_' + currentMonthKey() + '.csv';
  link.click();
  URL.revokeObjectURL(url);
};

// Affichage rapide
(function() {
  var b = document.getElementById('userBadge');
  function reveal() { document.body.classList.add('ready'); }
  if (b && b.style.display !== 'none') { reveal(); return; }
  if (b) {
    var obs = new MutationObserver(function() {
      if (b.style.display !== 'none') { reveal(); obs.disconnect(); }
    });
    obs.observe(b, { attributes: true, attributeFilter: ['style'] });
  }
  setTimeout(reveal, 900);
})();

initAuth(function() {
  document.getElementById('tabViewUsers').style.display = state.currentUserRole === 'Administrateur' ? '' : 'none';
  document.body.classList.add('ready');
  loadPointage();
});

// Mettre à jour le tableau quand la date change
document.getElementById('dateJour').addEventListener('change', function() {
  loadPointage();
});
