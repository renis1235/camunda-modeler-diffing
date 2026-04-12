import { state, dom } from './diff-state.js';
import { navigateToElement, selectInDiagram, clearDiagramSelection } from './diff-markers.js';

// ─── Impact classification ────────────────────────────────────────────────────
// Each change is classified to help reviewers quickly understand what actually
// affects process behaviour:
//
//   structural  🔴  Flow topology (gateways, flows, tasks, events added/removed)
//   semantic    🟡  Behavioural properties (names, expressions, implementations)
//   visual      ⚪  Layout / repositioning only — no behavioural impact

/** @typedef {'structural'|'semantic'|'visual'} ImpactLevel */

// Data annotations and cosmetic elements: when added/removed they are semantic,
// not structural, because they do not affect token routing.
const DATA_ANNOTATION_TYPES = new Set([
    'bpmn:DataObjectReference', 'bpmn:DataStoreReference',
    'bpmn:TextAnnotation', 'bpmn:Group'
]);

// Changes to these attributes alter how tokens flow through the process.
const STRUCTURAL_ATTRS = new Set([
    'conditionExpression', 'default', 'sourceRef', 'targetRef'
]);

/** Used to find the highest-severity impact across items in a section. */
const IMPACT_ORDER = {structural: 2, semantic: 1, visual: 0};

/**
 * Classify the severity of a single change.
 *
 * @param {string|undefined} elementType  BPMN type string, e.g. 'bpmn:SequenceFlow'.
 * @param {string}           diffKey      Key from the diff result object.
 * @param {Object|null}      attrs        Changed attributes (only present for _changed entries).
 * @returns {ImpactLevel}
 */
function classifyChange(elementType, diffKey, attrs) {
    if (diffKey === '_layoutChanged') return 'visual';

    if (diffKey === '_added' || diffKey === '_removed') {
        return DATA_ANNOTATION_TYPES.has(elementType) ? 'semantic' : 'structural';
    }

    // _changed: structural only if a flow-critical attribute was modified
    const hasStructuralAttr = attrs && Object.keys(attrs).some(a => STRUCTURAL_ATTRS.has(a));
    return hasStructuralAttr ? 'structural' : 'semantic';
}

// ─── BPMN type display labels ─────────────────────────────────────────────────

const BPMN_TYPE_LABELS = {
    'bpmn:UserTask': 'User Task',
    'bpmn:ServiceTask': 'Service Task',
    'bpmn:ScriptTask': 'Script Task',
    'bpmn:ManualTask': 'Manual Task',
    'bpmn:BusinessRuleTask': 'Business Rule Task',
    'bpmn:SendTask': 'Send Task',
    'bpmn:ReceiveTask': 'Receive Task',
    'bpmn:CallActivity': 'Call Activity',
    'bpmn:SubProcess': 'Sub Process',
    'bpmn:Task': 'Task',
    'bpmn:StartEvent': 'Start Event',
    'bpmn:EndEvent': 'End Event',
    'bpmn:IntermediateCatchEvent': 'Catch Event',
    'bpmn:IntermediateThrowEvent': 'Throw Event',
    'bpmn:BoundaryEvent': 'Boundary Event',
    'bpmn:ExclusiveGateway': 'Exclusive Gateway',
    'bpmn:InclusiveGateway': 'Inclusive Gateway',
    'bpmn:ParallelGateway': 'Parallel Gateway',
    'bpmn:EventBasedGateway': 'Event Gateway',
    'bpmn:ComplexGateway': 'Complex Gateway',
    'bpmn:SequenceFlow': 'Sequence Flow',
    'bpmn:MessageFlow': 'Message Flow',
    'bpmn:DataObjectReference': 'Data Object',
    'bpmn:DataStoreReference': 'Data Store',
    'bpmn:Lane': 'Lane',
    'bpmn:Participant': 'Pool',
    'bpmn:Process': 'Process',
};

/**
 * Return a readable display label for a bpmn-moddle element's $type.
 * Exported so diff-export.js can reuse it during serialisation.
 *
 * @param {*} element
 * @returns {string}
 */
export function getTypeLabel(element) {
    if (!element || !element.$type) return '';
    return BPMN_TYPE_LABELS[element.$type] || element.$type.replace(/^.*:/, '');
}

/**
 * Escape a string for safe insertion into HTML attributes and text content.
 * @param {*} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Panel section definitions ────────────────────────────────────────────────
// Keys (_added, _removed, etc.) are the literal property names returned by
// bpmn-js-differ's diff() call.

const PANEL_SECTIONS = [
    {key: '_added', label: 'Added', dotCls: 'cs-dot-added'},
    {key: '_removed', label: 'Removed', dotCls: 'cs-dot-removed'},
    {key: '_changed', label: 'Modified', dotCls: 'cs-dot-changed'},
    {key: '_layoutChanged', label: 'Repositioned', dotCls: 'cs-dot-changed'},
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Populate the changes panel with diff results.
 * Items are built before section headers so the highest-severity impact badge
 * (topImpact) can be computed before the header is rendered.
 *
 * @param {import('./diff-state.js').DiffResult} diffResult
 */
export function fillChangesPanel(diffResult) {
    dom.changesSections.innerHTML = '';
    let total = 0;

    PANEL_SECTIONS.forEach(function (section) {
        const entries = diffResult[section.key] || {};
        const ids = Object.keys(entries);
        if (ids.length === 0) return;
        total += ids.length;

        let topImpact = 'visual';
        const itemsEl = document.createElement('div');
        itemsEl.className = 'cs-items';

        ids.forEach(function (id) {
            const entry = entries[id];

            // bpmn-js-differ wraps _changed entries as { model, attrs }.
            // All other entry types are the bpmn-moddle element directly.
            const element = (section.key === '_changed' && entry.model) ? entry.model : entry;
            const attrs = (section.key === '_changed' && entry.attrs) ? entry.attrs : null;

            const impact = classifyChange(element && element.$type, section.key, attrs);
            if (IMPACT_ORDER[impact] > IMPACT_ORDER[topImpact]) topImpact = impact;

            itemsEl.appendChild(buildItemEl(id, element, attrs, impact));
        });

        const sectionEl = document.createElement('div');
        sectionEl.className = 'cs';
        sectionEl.appendChild(buildSectionHeader(section, ids.length, topImpact, itemsEl));
        sectionEl.appendChild(itemsEl);
        dom.changesSections.appendChild(sectionEl);
    });

    dom.changesTitle.textContent = 'Changes (' + total + ')';
    dom.changesSections.style.display = total > 0 ? '' : 'none';
    dom.changesPlaceholder.style.display = total > 0 ? 'none' : '';
    if (total === 0) dom.changesPlaceholder.textContent = 'No differences found.';

    // Auto-expand the panel when results become available.
    dom.changesPanel.classList.remove('collapsed');
    dom.changesToggle.innerHTML = '&#9660;';
    dom.changesToggle.title = 'Hide changes';
}

/**
 * Clear all panel content and reset selection state.
 */
export function clearChangesPanel() {
    if (state.activeItem) {
        state.activeItem.classList.remove('ci-active');
        state.activeItem = null;
    }
    clearDiagramSelection();
    state.activeId = null;
    dom.changesSections.innerHTML = '';
    dom.changesSections.style.display = 'none';
    dom.changesPlaceholder.style.display = '';
    dom.changesPlaceholder.textContent = 'Load a target file to see changes.';
    dom.changesTitle.textContent = 'Changes';
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build the DOM element for a single change item.
 *
 * @param {string}        id
 * @param {*}             element  bpmn-moddle element.
 * @param {Object|null}   attrs    Changed attributes map, or null.
 * @param {ImpactLevel}   impact
 * @returns {HTMLElement}
 */
function buildItemEl(id, element, attrs, impact) {
    const impactLetter = impact === 'structural' ? 'S' : impact === 'semantic' ? 'M' : 'V';
    const impactTitle =
        impact === 'structural' ? 'Structural \u2014 affects process flow' :
            impact === 'semantic' ? 'Semantic \u2014 affects behaviour or properties' :
                'Visual \u2014 layout change only';

    const nameHtml = (element && element.name)
        ? `<span class="ci-name" title="${escapeHtml(id)}">${escapeHtml(element.name)}</span>`
        : `<span class="ci-name ci-name-id" title="${escapeHtml(id)}">${escapeHtml(id)}</span>`;

    const typeLabel = getTypeLabel(element);
    const typeHtml = typeLabel ? `<span class="ci-type">${escapeHtml(typeLabel)}</span>` : '';

    let html = `<div class="ci-row">${nameHtml}${typeHtml}` +
        `<span class="ci-impact ci-impact-${impact}" title="${impactTitle}">${impactLetter}</span>` +
        `</div>`;

    // Append old → new values for each changed attribute.
    if (attrs) {
        Object.keys(attrs).forEach(function (prop) {
            const ch = attrs[prop];
            const oldV = ch.oldVal != null ? escapeHtml(String(ch.oldVal)) : '';
            const newV = ch.newVal != null ? escapeHtml(String(ch.newVal)) : '';
            html += `<div class="ci-attr">` +
                `<span class="ci-prop">${escapeHtml(prop)}</span>: ` +
                (oldV ? `<span class="ci-old">${oldV}</span> &rarr; ` : '') +
                `<span class="ci-new">${newV}</span></div>`;
        });
    }

    const ci = document.createElement('div');
    ci.className = 'ci';
    ci.innerHTML = html;

    ci.addEventListener('click', function () {
        if (state.activeItem) {
            state.activeItem.classList.remove('ci-active');
            clearDiagramSelection();
        }
        ci.classList.add('ci-active');
        state.activeItem = ci;
        state.activeId = id;
        navigateToElement(id);
        selectInDiagram(id);
    });

    return ci;
}

/**
 * Build the collapsible section header element.
 * Must be called *after* buildItemEl so topImpact is already known.
 *
 * @param {{ key: string, label: string, dotCls: string }} section
 * @param {number}        count
 * @param {ImpactLevel}   topImpact
 * @param {HTMLElement}   itemsEl  Items container toggled by the header click.
 * @returns {HTMLElement}
 */
function buildSectionHeader(section, count, topImpact, itemsEl) {
    const topLetter = topImpact === 'structural' ? 'S' : topImpact === 'semantic' ? 'M' : 'V';

    const hdr = document.createElement('div');
    hdr.className = 'cs-hdr';
    hdr.innerHTML =
        `<span class="cs-dot ${section.dotCls}"></span>
         <span class="cs-label">${section.label}</span>
         <span class="cs-count">${count}</span>
         <span class="cs-impact cs-impact-${topImpact}">${topLetter}</span>
         <span class="cs-arrow">&#9662;</span>`;

    hdr.addEventListener('click', function () {
        itemsEl.classList.toggle('cs-collapsed');
        hdr.querySelector('.cs-arrow').innerHTML =
            itemsEl.classList.contains('cs-collapsed') ? '&#9656;' : '&#9662;';
    });

    return hdr;
}
