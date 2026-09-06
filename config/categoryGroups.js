'use strict';

// ─── Oberkategorien (E3) ──────────────────────────────────────────────────
// Die ~25 Detailkategorien werden im Shop-Filter unter wenige Oberkategorien
// gruppiert (zweistufige Auswahl). Zuordnung erfolgt über den Kategorie-Slug.
// WICHTIG: Rein darstellungsseitig — keine DB-/Schema-Änderung. Jede Kategorie,
// deren Slug hier nicht auftaucht (z. B. abweichende Live-Slugs), landet
// automatisch in der Auffang-Gruppe "Weitere Kategorien" und geht nie verloren.
const GROUPS = [
  {
    title: 'Verteilung & Gehäuse',
    icon: '🗄️',
    children: [
      'r-box-verteilergehaeuse-und-verteilerschraenke',
      'gehaeuse-und-verteilerschraenke',
      's-box-dosen',
      'r-box-slim-verteilergehaeuse',
      'installationsdosen',
      'r-box-kompakt-mini-verteilergehaeuse',
    ],
  },
  {
    title: 'Klemmen & Verbindungstechnik',
    icon: '🔌',
    children: [
      'klemmleisten',
      '12-polige-klemmenleisten',
      'reihenklemmen',
    ],
  },
  {
    title: 'Beleuchtung',
    icon: '💡',
    children: [
      'leuchten',
      'leuchtenfassungen',
    ],
  },
  {
    title: 'Steckdosen & Schalter',
    icon: '🔲',
    children: [
      'hermetische-steckdosen-und-schalter-beta',
      'verlaengerungskabel-und-abzweigsteckdosen',
      'zubehoer-fuer-verlaengerungskabel',
    ],
  },
  {
    title: 'Blitzschutz & Erdung',
    icon: '⚡',
    children: [
      'elemente-der-blitzschutzanlage',
      'erdungsanlagen',
    ],
  },
  {
    title: 'Kabelmanagement',
    icon: '🔗',
    children: [
      'kabelschellen-mit-nagel',
      'wellrohre',
      'kabelhalter',
      'kabelkanaele',
      'kabelverschraubungen',
      'kabelbaender',
      'kabelbinder',
    ],
  },
  {
    title: 'Installationszubehör & Sonstiges',
    icon: '🛠️',
    children: [
      'installationszubehoer',
      'stromschienen',
    ],
  },
];

const CATCH_ALL_TITLE = 'Weitere Kategorien';

/**
 * Gruppiert eine flache Kategorienliste (jeweils mit slug, name, cnt) in die
 * Oberkategorien-Reihenfolge. Nur Gruppen mit vorhandenen Kategorien werden
 * zurückgegeben. Nicht zugeordnete Kategorien → Auffang-Gruppe.
 * @param {Array<{slug:string,name:string,cnt:number}>} categories
 * @returns {Array<{title:string,icon:string,cnt:number,items:Array}>}
 */
function groupCategories(categories) {
  const bySlug = new Map((categories || []).map(c => [c.slug, c]));
  const used = new Set();
  const out = [];

  for (const g of GROUPS) {
    const items = [];
    for (const slug of g.children) {
      const cat = bySlug.get(slug);
      if (cat) { items.push(cat); used.add(slug); }
    }
    if (items.length) {
      out.push({
        title: g.title,
        icon: g.icon,
        cnt: items.reduce((s, c) => s + (c.cnt || 0), 0),
        items,
      });
    }
  }

  // Auffang-Gruppe: alles, was keiner Oberkategorie zugeordnet ist
  const rest = (categories || []).filter(c => !used.has(c.slug));
  if (rest.length) {
    out.push({
      title: CATCH_ALL_TITLE,
      icon: '📦',
      cnt: rest.reduce((s, c) => s + (c.cnt || 0), 0),
      items: rest,
    });
  }

  return out;
}

module.exports = { GROUPS, groupCategories, CATCH_ALL_TITLE };
