/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SIRDI CONNECTOR v0.1                                        ║
 * ║  Swift Fortress Ltd · Patent pending GB2605007.0             ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  The connector is the first executable proof that the       ║
 * ║  ecosystem is one governed modular system rather than a     ║
 * ║  collection of disconnected portals.                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * HONEST STATE
 * The shared data model, local receipt flow, and portal connector
 * logic are implemented. External service connections remain
 * defined integration points pending credentials and endpoint
 * configuration.
 *
 * OWNERSHIP RULE
 * The connector owns transport, shared objects, and common UI.
 * Each portal owns its own workflows and presentation.
 *
 * USAGE
 *   <script src="sirdi-connector.js" data-portal="landing|crm|research"></script>
 *
 * INTERNAL MODULE MAP
 *   [M1] SCHEMA     — frozen v0.1 canonical shapes
 *   [M2] STORAGE    — namespaced persistence layer
 *   [M3] CRYPTO     — receipt + chain primitives
 *   [M4] RECEIPT    — governed action receipt builder
 *   [M5] WEBHOOK    — landing-page form → CRM intake flow
 *   [M6] NAV        — shared navigation component
 *   [M7] BUS        — cross-portal event bus
 *   [M8] API        — public window.SIRDI surface
 *   [M9] BOOT       — portal-aware activation
 *
 * Each module is a named IIFE-returned object with a minimal
 * public interface. Extracting any one into its own file later
 * requires copy-paste, not rewrite.
 */

(function (global) {
  'use strict';


  /* ══════════════════════════════════════════════════════════════
     [M1] SCHEMA
     Frozen v0.1 canonical model. Six shapes only. Do not inflate.
     Extensions go in extension files, not this core.
  ═══════════════════════════════════════════════════════════════ */
  const Schema = (function () {
    const now = () => new Date().toISOString();
    const uid = (prefix) => prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 5);

    return {
      Contact: (d = {}) => ({
        id:         d.id         || uid('c'),
        name:       d.name       || '',
        email:      d.email      || '',
        role:       d.role       || '',
        company:    d.company    || '',
        tooling:    d.tooling    || '',
        source:     d.source     || 'direct',
        source_url: d.source_url || '',
        created:    d.created    || now(),
        updated:    d.updated    || now(),
        tags:       d.tags       || [],
      }),

      Organisation: (d = {}) => ({
        id:         d.id         || uid('o'),
        name:       d.name       || '',
        sector:     d.sector     || '',
        size:       d.size       || '',
        country:    d.country    || 'GB',
        compliance: d.compliance || [],
        created:    d.created    || now(),
      }),

      Opportunity: (d = {}) => ({
        id:           d.id           || uid('op'),
        contact_id:   d.contact_id   || '',
        org_id:       d.org_id       || '',
        stage:        d.stage        || 'new',
        value:        d.value        || 1500,
        currency:     d.currency     || 'GBP',
        source:       d.source       || '',
        template_id:  d.template_id  || null,
        last_contact: d.last_contact || null,
        seq_day:      d.seq_day      || 0,
        created:      d.created      || now(),
        updated:      d.updated      || now(),
      }),

      Receipt: (d = {}) => ({
        receipt_id:       d.receipt_id       || 'SGN-' + Date.now().toString(36).toUpperCase(),
        timestamp:        d.timestamp        || now(),
        node:             d.node             || 'System',
        action:           d.action           || '',
        target:           d.target           || '',
        actor_role:       d.actor_role       || 'system',
        decision:         d.decision         || 'ALLOW',
        payload_hash:     d.payload_hash     || '',
        chain_hash:       d.chain_hash       || '',
        previous_hash:    d.previous_hash    || null,
        patent_ref:       'GB2605007.0',
        is_correction:    d.is_correction    || false,
        corrects_receipt: d.corrects_receipt || null,
      }),

      StageTransition: (d = {}) => ({
        id:          d.id          || uid('t'),
        opp_id:      d.opp_id      || '',
        from_stage:  d.from_stage  || '',
        to_stage:    d.to_stage    || '',
        actor_role:  d.actor_role  || '',
        receipt_id:  d.receipt_id  || '',
        timestamp:   d.timestamp   || now(),
      }),

      PortalEvent: (d = {}) => ({
        id:        d.id        || uid('e'),
        portal:    d.portal    || '',
        event:     d.event     || '',
        detail:    d.detail    || {},
        timestamp: d.timestamp || now(),
      }),
    };
  })();


  /* ══════════════════════════════════════════════════════════════
     [M2] STORAGE
     Namespaced persistence. Browser-backed in v0.1 — demo/local
     prototype state, not a production backend.
  ═══════════════════════════════════════════════════════════════ */
  const Storage = (function () {
    const NS = 'sirdi-v1-';

    async function get(key) {
      try {
        const r = (window.storage && typeof window.storage.get === 'function') ? await window.storage.get(NS + key) : (localStorage.getItem(NS + key) ? { value: localStorage.getItem(NS + key) } : null);
        return r ? JSON.parse(r.value) : null;
      } catch (_) { return null; }
    }

    async function set(key, value) {
      try {
        if (window.storage && typeof window.storage.set === 'function') { await window.storage.set(NS + key, JSON.stringify(value)); } else { localStorage.setItem(NS + key, JSON.stringify(value)); }
        return true;
      } catch (err) { console.error('Storage.set failed', err); return false; }
    }

    async function getList(key) {
      return (await get(key)) || [];
    }

    async function pushToList(key, item) {
      const next = [item, ...(await getList(key))];
      await set(key, next);
      return next;
    }

    async function updateInList(key, id, patch) {
      const list = await getList(key);
      const next = list.map(x =>
        x.id === id ? { ...x, ...patch, updated: new Date().toISOString() } : x
      );
      await set(key, next);
      return next;
    }

    return { get, set, getList, pushToList, updateInList, NS };
  })();


  /* ══════════════════════════════════════════════════════════════
     [M3] CRYPTO
     SHA-256 hashing. Ed25519 remains a placeholder — real signing
     happens on the Ubuntu SIRDI instance, not in the browser.
  ═══════════════════════════════════════════════════════════════ */
  const Crypto = (function () {
    async function sha256(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    }

    return { sha256 };
  })();


  /* ══════════════════════════════════════════════════════════════
     [M4] RECEIPT
     Governed action receipt builder. Chains every receipt to the
     previous head hash. Demo-state chain — real signing is
     deferred to the Ubuntu verifier.
  ═══════════════════════════════════════════════════════════════ */
  const ReceiptEngine = (function () {
    async function build(node, action, target, payload, role) {
      const chainHead = await Storage.get('chain-head');
      const ts        = new Date().toISOString();
      const ph        = await Crypto.sha256(JSON.stringify({ node, action, target, payload, ts, role }));
      const ch        = await Crypto.sha256((chainHead || '0'.repeat(64)) + ph);
      const id        = 'SGN-' + Date.now().toString(36).toUpperCase() +
                        '-' + Math.random().toString(36).slice(2, 4).toUpperCase();

      const receipt = Schema.Receipt({
        receipt_id:    id,
        timestamp:     ts,
        node,
        action,
        target,
        actor_role:    role || 'system',
        payload_hash:  ph,
        chain_hash:    ch,
        previous_hash: chainHead || null,
      });

      await Storage.pushToList('receipts', receipt);
      await Storage.set('chain-head', ch);
      return receipt;
    }

    return { build };
  })();


  /* ══════════════════════════════════════════════════════════════
     [M5] WEBHOOK
     Landing-page form → CRM intake. Connects the acquisition
     layer to the governed relationship layer via shared schema.
  ═══════════════════════════════════════════════════════════════ */
  const Webhook = (function () {
    function wire() {
      const form = document.getElementById('accessForm');
      if (!form) return;

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const fd = new FormData(form);
        const payload = {
          name:    (fd.get('name')    || '').trim(),
          email:   (fd.get('email')   || '').trim(),
          company: (fd.get('company') || '').trim(),
          role:    (fd.get('role')    || '').trim(),
          tooling: (fd.get('tooling') || '').trim(),
        };

        if (!payload.name || !payload.email || !payload.company) return;

        const contact = Schema.Contact({ ...payload, source: 'landing-page' });
        const org     = Schema.Organisation({ name: payload.company });
        const opp     = Schema.Opportunity({
          contact_id: contact.id,
          org_id:     org.id,
          stage:      'new',
          source:     'landing-page',
        });

        await Storage.pushToList('contacts',      contact);
        await Storage.pushToList('organisations', org);
        await Storage.pushToList('opportunities', opp);

        const receipt = await ReceiptEngine.build(
          'Landing Page',
          'INBOUND_LEAD_CAPTURED',
          payload.name + ' @ ' + payload.company,
          { contact_id: contact.id, opp_id: opp.id, source: 'landing-page' },
          'system'
        );

        Bus.emit('lead-captured', { contact, org, opp, receipt });

      await fetch('http://127.0.0.1:8010/intake/lead', {
        method: 'POST',
        mode: 'no-cors',
        body: fd
      });

        /* ─── INTEGRATION POINTS (pending credentials) ────────
           External service routing — pick one, uncomment,
           configure. Do not add more than one production sink
           without a receipt-linked deduplication key.

           A) Formspree
              await fetch('http://127.0.0.1:8010/intake/lead', {
                method: 'POST', body: fd,
                headers: { Accept: 'application/json' }
              });

           B) GoHighLevel webhook
              await fetch('https://hooks.zapier.com/hooks/catch/YOUR_GHL_ID', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, receipt_id: receipt.receipt_id })
              });

           C) Ubuntu SIRDI endpoint
              await fetch('https://your-endpoint/govern/intake', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact, opp, receipt })
              });
        ──────────────────────────────────────────────────────── */

        showSuccess(form);
      });
    }

    function showSuccess(form) {
      const successEl = document.getElementById('formSuccess');
      if (successEl) {
        form.style.display      = 'none';
        successEl.style.display = 'block';
      }
      if (window.gtag) {
        window.gtag('event', 'pilot_request', { event_category: 'conversion' });
      }
    }

    return { wire };
  })();


  /* ══════════════════════════════════════════════════════════════
     [M6] NAV
     Shared navigation component. Self-contained styles, active-
     state detection from data-portal attribute on script tag.
  ═══════════════════════════════════════════════════════════════ */
  const Nav = (function () {
    const STYLES = [
      '.sirdi-portal-nav{position:sticky;top:0;z-index:200;background:rgba(8,12,16,0.95);backdrop-filter:blur(12px);border-bottom:1px solid #1a2535;padding:0.625rem 0;font-family:"Space Mono",ui-monospace,monospace}',
      '.sirdi-portal-nav__inner{max-width:1140px;margin:0 auto;padding:0 clamp(1.25rem,4vw,2rem);display:flex;align-items:center;justify-content:space-between;gap:1rem}',
      '.sirdi-portal-nav__brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1rem;letter-spacing:0.06em;color:#e8edf2;text-decoration:none}',
      '.sirdi-portal-nav__brand-mark{width:26px;height:26px;border:1.5px solid #00c896;border-radius:4px;display:flex;align-items:center;justify-content:center}',
      '.sirdi-portal-nav__brand-mark svg{width:12px;height:12px;fill:#00c896}',
      '.sirdi-portal-nav__portals{display:flex;align-items:center;gap:4px;list-style:none;margin:0;padding:0}',
      '.sirdi-portal-nav__portals a{font-size:11px;letter-spacing:0.07em;color:#7a8fa6;text-decoration:none;padding:5px 12px;border-radius:4px;border:1px solid transparent;transition:all 0.18s ease;display:flex;align-items:center;gap:6px}',
      '.sirdi-portal-nav__portals a:hover{color:#00e5aa;border-color:#00c89640;background:#00c89610}',
      '.sirdi-portal-nav__portals a.active{color:#00e5aa;border-color:#00c89640;background:#00c89615;font-weight:700}',
      '.sirdi-portal-nav__portals .portal-dot{width:5px;height:5px;border-radius:50%;background:#3d5166;flex-shrink:0}',
      '.sirdi-portal-nav__portals a.active .portal-dot{background:#00c896}',
      '.sirdi-portal-nav__badge{font-size:9px;padding:2px 6px;border-radius:3px;background:#00c89620;color:#00c896;border:1px solid #00c89640;letter-spacing:0.05em}',
      '.sirdi-portal-nav__state{font-size:10px;color:#3d5166;letter-spacing:0.04em;white-space:nowrap;display:flex;align-items:center;gap:6px}',
      '.sirdi-portal-nav__state::before{content:"";width:6px;height:6px;border-radius:50%;background:#00c896;box-shadow:0 0 8px #00c89666}',
      '@media (max-width:680px){.sirdi-portal-nav__portals{display:none}.sirdi-portal-nav__state{display:none}}'
    ].join('');

    const PORTALS = [
      { id: 'landing',  label: 'swift fortress', href: '/',         badge: null  },
      { id: 'crm',      label: 'pipeline',       href: '/crm.html',      badge: 'CRM' },
      { id: 'research', label: 'grant node os',  href: '/research.html', badge: 'R&D' },
    ];

    function inject(currentPortal) {
      if (!document.getElementById('sirdi-nav-styles')) {
        const s = document.createElement('style');
        s.id = 'sirdi-nav-styles';
        s.textContent = STYLES;
        document.head.appendChild(s);
      }

      const links = PORTALS.map(function (p) {
        const active = p.id === currentPortal ? 'active' : '';
        const badge  = p.badge ? '<span class="sirdi-portal-nav__badge">' + p.badge + '</span>' : '';
        return '<li><a href="' + p.href + '" class="' + active + '"><span class="portal-dot"></span>' + p.label + badge + '</a></li>';
      }).join('');

      const html =
        '<nav class="sirdi-portal-nav" role="navigation" aria-label="SIRDI portal navigation">' +
          '<div class="sirdi-portal-nav__inner">' +
            '<a href="/" class="sirdi-portal-nav__brand">' +
              '<div class="sirdi-portal-nav__brand-mark">' +
                '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1L13 4V10L7 13L1 10V4L7 1Z"/></svg>' +
              '</div>SIRDI</a>' +
            '<ul class="sirdi-portal-nav__portals" role="list">' + links + '</ul>' +
            '<span class="sirdi-portal-nav__state" id="sirdi-nav-state">local chain · 0 receipts</span>' +
          '</div>' +
        '</nav>';

      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      document.body.insertBefore(wrapper.firstElementChild, document.body.firstElementChild);

      Storage.getList('receipts').then(function (r) {
        const el = document.getElementById('sirdi-nav-state');
        if (el) {
          const n = r.length || 0;
          el.textContent = 'local chain · ' + n + ' receipt' + (n !== 1 ? 's' : '');
        }
      });
    }

    return { inject };
  })();


  /* ══════════════════════════════════════════════════════════════
     [M7] BUS
     Cross-portal event bus. Low-coupling communication via
     custom events on the window object.
  ═══════════════════════════════════════════════════════════════ */
  const Bus = (function () {
    const PREFIX = 'sirdi:';

    function on(event, handler) {
      window.addEventListener(PREFIX + event, function (e) { handler(e.detail); });
    }

    function emit(event, detail) {
      window.dispatchEvent(new CustomEvent(PREFIX + event, { detail: detail }));
    }

    return { on: on, emit: emit };
  })();


  /* ══════════════════════════════════════════════════════════════
     [M8] API
     Public window.SIRDI surface. The only thing portals should
     use directly. Internal modules are not exposed.
  ═══════════════════════════════════════════════════════════════ */
  const Api = (function () {
    async function getLeads() {
      const [contacts, opps] = await Promise.all([
        Storage.getList('contacts'),
        Storage.getList('opportunities'),
      ]);
      return contacts.map(function (c) {
        return Object.assign({}, c, {
          opportunity: opps.find(function (o) { return o.contact_id === c.id; }) || null,
        });
      });
    }

    async function advanceStage(opp_id, new_stage, actor_role) {
      const opps = await Storage.getList('opportunities');
      const opp  = opps.find(function (o) { return o.id === opp_id; });
      if (!opp) return null;

      await Storage.updateInList('opportunities', opp_id, {
        stage:        new_stage,
        last_contact: new Date().toISOString().split('T')[0],
      });

      const receipt = await ReceiptEngine.build(
        'CRM', 'ADVANCE_STAGE', opp_id,
        { from: opp.stage, to: new_stage },
        actor_role
      );

      const transition = Schema.StageTransition({
        opp_id:     opp_id,
        from_stage: opp.stage,
        to_stage:   new_stage,
        actor_role: actor_role,
        receipt_id: receipt.receipt_id,
      });
      await Storage.pushToList('transitions', transition);

      Bus.emit('stage-advanced', { opp_id: opp_id, transition: transition, receipt: receipt });
      return receipt;
    }

    async function stats() {
      const [contacts, opps, receipts, exceptions] = await Promise.all([
        Storage.getList('contacts'),
        Storage.getList('opportunities'),
        Storage.getList('receipts'),
        Storage.getList('exceptions'),
      ]);
      return {
        contacts:   contacts.length,
        pipeline:   opps.filter(function (o) { return ['pilot_accepted','not_converted'].indexOf(o.stage) === -1; }).length,
        converted:  opps.filter(function (o) { return o.stage === 'pilot_accepted'; }).length,
        receipts:   receipts.length,
        exceptions: exceptions.filter(function (e) { return e.status === 'open'; }).length,
        chain_head: await Storage.get('chain-head'),
      };
    }

    return {
      Schema:        Schema,
      Store:         Storage,
      buildReceipt:  ReceiptEngine.build,
      EventBus:      Bus,
      getLeads:      getLeads,
      advanceStage:  advanceStage,
      stats:         stats,
      version:       '0.1.0',
      patent:        'GB2605007.0',
      state:         'local prototype chain · external integrations pending',
    };
  })();


  /* ══════════════════════════════════════════════════════════════
     [M9] BOOT
     Portal-aware activation. Reads data-portal attribute and
     wires only the modules that surface needs.
  ═══════════════════════════════════════════════════════════════ */
  const Boot = (function () {
    function run() {
      const scriptTag  = document.querySelector('script[data-portal]');
      const portalName = (scriptTag && scriptTag.dataset && scriptTag.dataset.portal) || 'landing';

      const activate = function () {
        Nav.inject(portalName);
        if (portalName === 'landing') Webhook.wire();
        Bus.emit('connector-ready', { portal: portalName, version: Api.version });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', activate);
      } else {
        activate();
      }

      console.log(
        '%cSIRDI Connector v' + Api.version + ' · ' + portalName +
        ' · ' + Api.patent + ' · ' + Api.state,
        'color:#00c896;font-family:monospace;font-size:11px;'
      );
    }

    return { run: run };
  })();


  /* ── EXPOSE PUBLIC API AND BOOT ─────────────────────────── */
  global.SIRDI = Api;
  Boot.run();

})(window);
