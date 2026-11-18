import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';
import type { Category, CostType, MapData, MappedLocation, Service } from './types.js';

const CITY_CENTER: L.LatLngTuple = [43.0962, -79.0377];
const UNKNOWN = 'Call to confirm';
const COST_LABELS: Record<CostType, string> = {
  free: 'Free',
  paid: 'Paid',
  insurance: 'Insurance or billing',
  unknown: UNKNOWN,
};
const FALLBACK_COLOR = '#37474F';
const MAX_CARD_MATCHES = 3;
const WIDE_LAYOUT = window.matchMedia('(min-width: 900px)');

const app = document.querySelector<HTMLElement>('#app')!;
const controls = document.querySelector<HTMLElement>('#controls')!;
const search = document.querySelector<HTMLInputElement>('#search')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const summary = document.querySelector<HTMLParagraphElement>('#summary')!;
const directory = document.querySelector<HTMLDivElement>('#directory')!;
const review = document.querySelector<HTMLTableSectionElement>('#address-review')!;
const categoryFilters = document.querySelector<HTMLDivElement>('#category-filters')!;
const needFilters = document.querySelector<HTMLDivElement>('#need-filters')!;
const clearFilters = document.querySelector<HTMLButtonElement>('#clear-filters')!;
const inactiveSection = document.querySelector<HTMLDetailsElement>('#inactive-section')!;
const inactiveList = document.querySelector<HTMLUListElement>('#inactive-list')!;
const mapElement = document.querySelector<HTMLDivElement>('#map')!;
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view-button]')];

const map = L.map(mapElement, { zoomControl: false }).setView(CITY_CENTER, 14);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);
const pins = L.layerGroup().addTo(map);
const markers = new Map<number, L.Marker>();

let data: MapData = { categories: [], locations: [], needsGeocoding: false };
let categoryById = new Map<string, Category>();
const selectedCategories = new Set<string>();
const selectedNeeds = new Map<string, Set<string>>();
const openDetails = new Set<number>();
let loadingMessage = '';
let pendingBounds: L.LatLngTuple[] | undefined;

// ---- DOM helpers (data values always go through textContent) ----

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, ...children: (Node | string)[]) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  result.append(...children);
  return result;
}

function link(href: string, text: string, className?: string, external = false) {
  const anchor = textElement('a', text, className);
  anchor.href = href;
  if (external) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  return anchor;
}

function actionButton(text: string, onClick: () => void, className = 'action') {
  const button = textElement('button', text, className);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

const telHref = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return `tel:${digits.length === 10 ? `+1${digits}` : digits}`;
};
const displayAddress = (location: MappedLocation) => `${location.streetAddress}, Niagara Falls`;
const directionsUrl = (location: MappedLocation) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location.fullAddress)}`;
const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

function websiteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ---- Filtering ----

const allServices = (location: MappedLocation) => location.serviceGroups.flatMap((group) => group.services);
const needsFor = (categoryId: string) => selectedNeeds.get(categoryId) ?? new Set<string>();
const searchTerm = () => search.value.trim().toLowerCase();
const filtersActive = () => selectedCategories.size > 0 || searchTerm() !== '';

function serviceMatchesCategory(service: Service, categoryId: string) {
  if (!service.categories.includes(categoryId)) return false;
  const needs = needsFor(categoryId);
  return needs.size === 0 || service.needs.some((need) => needs.has(need));
}

function locationMatchesCategory(location: MappedLocation, categoryId: string) {
  if (!location.categories.includes(categoryId)) return false;
  return needsFor(categoryId).size === 0 || allServices(location).some((service) => serviceMatchesCategory(service, categoryId));
}

function serviceMatchesSearch(service: Service, term: string) {
  return Boolean(term) && [service.name, ...service.needs].some((value) => value.toLowerCase().includes(term));
}

function isHighlighted(service: Service, term: string) {
  return serviceMatchesSearch(service, term)
    || [...selectedCategories].some((categoryId) => serviceMatchesCategory(service, categoryId));
}

function locationMatches(location: MappedLocation, term: string) {
  if (!location.active) return false;
  if (selectedCategories.size && ![...selectedCategories].some((categoryId) => locationMatchesCategory(location, categoryId))) return false;
  if (!term) return true;
  const values = [
    location.name,
    location.streetAddress,
    ...location.categories.flatMap((id) => [categoryById.get(id)?.name ?? '', categoryById.get(id)?.short ?? '']),
    ...location.serviceGroups.map((group) => group.title),
    ...allServices(location).flatMap((service) => [service.name, ...service.needs]),
  ];
  return values.some((value) => value.toLowerCase().includes(term));
}

const filteredLocations = () => data.locations.filter((location) => locationMatches(location, searchTerm()));

function pinColor(location: MappedLocation) {
  const selected = [...selectedCategories].find((categoryId) => locationMatchesCategory(location, categoryId));
  return categoryById.get(selected ?? location.categories[0])?.color ?? FALLBACK_COLOR;
}

// ---- Filters ----

function chip(key: string, pressed: boolean, color: string, label: string, onClick: () => void, icon?: string, fullName?: string) {
  const button = element('button', 'chip');
  button.type = 'button';
  button.dataset.filterKey = key;
  button.setAttribute('aria-pressed', String(pressed));
  button.style.setProperty('--category-color', color);
  if (icon) {
    const iconSpan = textElement('span', icon, 'chip-icon');
    iconSpan.setAttribute('aria-hidden', 'true');
    button.append(iconSpan);
  }
  button.append(textElement('span', label));
  if (fullName && fullName !== label) button.title = fullName;
  button.addEventListener('click', () => {
    onClick();
    renderFilters();
    renderResults();
    controls.querySelector<HTMLButtonElement>(`[data-filter-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  });
  return button;
}

function renderFilters() {
  const active = data.locations.filter((location) => location.active);
  // Categories with no verified providers yet stay hidden until a location uses them.
  const used = data.categories.filter((category) => active.some((location) => location.categories.includes(category.id)));
  categoryFilters.replaceChildren(...used.map((category) => {
    const selected = selectedCategories.has(category.id);
    return chip(`category:${category.id}`, selected, category.color, category.short, () => {
      if (selected) {
        selectedCategories.delete(category.id);
        selectedNeeds.delete(category.id);
      } else {
        selectedCategories.add(category.id);
      }
    }, category.icon, category.name);
  }));

  const needChips = [...selectedCategories].flatMap((categoryId) => {
    const category = categoryById.get(categoryId)!;
    const chosen = needsFor(categoryId);
    return category.needs
      .filter((need) => active.some((location) => allServices(location)
        .some((service) => service.categories.includes(categoryId) && service.needs.includes(need))))
      .map((need) => chip(`need:${categoryId}:${need}`, chosen.has(need), category.color, need, () => {
        const next = new Set(chosen);
        if (next.has(need)) next.delete(need); else next.add(need);
        if (next.size) selectedNeeds.set(categoryId, next); else selectedNeeds.delete(categoryId);
      }));
  });
  needFilters.replaceChildren(...needChips);
  needFilters.hidden = needChips.length === 0;
  clearFilters.hidden = !filtersActive();
}

// ---- Cards ----

function pinNumber(location: MappedLocation) {
  const badge = textElement('span', String(location.id), 'pin-number');
  badge.style.backgroundColor = pinColor(location);
  return badge;
}

function categoryIcon(category: Category) {
  const icon = textElement('span', category.icon, 'category-icon');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', category.name);
  icon.title = category.name;
  return icon;
}

function serviceItem(service: Service, highlighted: boolean) {
  const item = element('li', highlighted ? 'service is-match' : 'service');
  item.append(highlighted ? textElement('mark', service.name) : textElement('span', service.name));
  if (service.hours) item.append(textElement('span', service.hours, 'service-hours'));
  if (service.limitedTo) item.append(textElement('span', `Only for: ${service.limitedTo}`, 'badge'));
  return item;
}

function infoRow(list: HTMLDListElement, label: string, ...value: (Node | string)[]) {
  list.append(textElement('dt', label), element('dd', undefined, ...value));
}

function cardActions(location: MappedLocation) {
  const actions = element('div', 'actions');
  if (location.phone) actions.append(link(telHref(location.phone), 'Call', 'action primary'));
  actions.append(link(directionsUrl(location), 'Directions', 'action', true));
  if (location.latitude !== null) actions.append(actionButton('Map', () => focusMarker(location.id)));
  return actions;
}

function moreInfo(location: MappedLocation, term: string) {
  const details = element('details', 'more-info');
  details.open = openDetails.has(location.id);
  details.addEventListener('toggle', () => {
    if (details.open) openDetails.add(location.id); else openDetails.delete(location.id);
  });
  details.append(textElement('summary', 'More info & all services'));

  const info = document.createElement('dl');
  infoRow(info, 'Phone', ...(location.phone
    ? [link(telHref(location.phone), location.phone), ...(location.phoneNote ? [` (${location.phoneNote})`] : [])]
    : ['Not listed']));
  for (const other of location.otherPhones) infoRow(info, other.label, link(telHref(other.number), other.number));
  infoRow(info, 'Hours', location.hours ?? UNKNOWN);
  infoRow(info, 'Cost', location.cost.note ?? COST_LABELS[location.cost.type]);
  infoRow(info, 'Eligibility', location.eligibility ?? UNKNOWN);
  infoRow(info, 'Walk-in or appointment', location.access ?? UNKNOWN);
  infoRow(info, 'Documents to bring', location.documents ?? UNKNOWN);
  if (location.websites.length) {
    infoRow(info, 'Website', ...location.websites.flatMap((url, index) => {
      const anchor = link(url, websiteLabel(url), undefined, true);
      return index ? [', ', anchor] : [anchor];
    }));
  }
  infoRow(info, 'Last verified', location.lastVerified ?? 'Not yet verified');
  details.append(info);

  if (location.notes.length) {
    details.append(element('ul', 'notes', ...location.notes.map((note) => textElement('li', note))));
  }
  for (const group of location.serviceGroups) {
    details.append(
      textElement('h4', group.title),
      element('ul', 'service-list', ...group.services.map((service) => serviceItem(service, isHighlighted(service, term)))),
    );
  }
  return details;
}

function renderCard(location: MappedLocation, term: string) {
  const card = element('article', 'card');
  card.id = `location-${location.id}`;

  const title = textElement('h3', location.name);
  title.tabIndex = -1;
  const head = element('div', 'card-head', pinNumber(location), title);
  const icons = element('span', 'category-icons', ...location.categories
    .map((id) => categoryById.get(id))
    .filter((category): category is Category => Boolean(category))
    .map(categoryIcon));
  card.append(head, element('p', 'card-meta', textElement('span', displayAddress(location)), icons));
  if (location.hours) card.append(textElement('p', location.hours, 'card-hours'));

  if (term || selectedCategories.size) {
    const matches = allServices(location).filter((service) => isHighlighted(service, term));
    if (matches.length) {
      const list = element('ul', 'service-list matches', ...matches.slice(0, MAX_CARD_MATCHES).map((service) => serviceItem(service, true)));
      if (matches.length > MAX_CARD_MATCHES) list.append(textElement('li', `+${matches.length - MAX_CARD_MATCHES} more in More info`, 'more-count'));
      card.append(list);
    }
  }
  card.append(cardActions(location), moreInfo(location, term));
  return card;
}

function renderDirectory(locations: MappedLocation[]) {
  const term = searchTerm();
  directory.replaceChildren(...(locations.length
    ? locations.map((location) => renderCard(location, term))
    : [textElement('p', 'No places match. Try fewer filters or a different search.', 'empty')]));
}

// ---- Map ----

function popupContent(location: MappedLocation) {
  const popup = element('div', 'popup',
    textElement('strong', `${location.id}. ${location.name}`),
    textElement('div', displayAddress(location)));
  if (location.hours) popup.append(textElement('div', location.hours));
  const actions = element('div', 'actions');
  if (location.phone) actions.append(link(telHref(location.phone), 'Call', 'action primary'));
  actions.append(link(directionsUrl(location), 'Directions', 'action', true), actionButton('Details', () => showDetails(location.id)));
  popup.append(actions);
  return popup;
}

function fitPins(points: L.LatLngTuple[]) {
  if (!points.length) return;
  if (mapElement.clientHeight === 0) {
    pendingBounds = points; // The map is hidden in list view; fit when it is shown.
    return;
  }
  pendingBounds = undefined;
  map.fitBounds(points, { padding: [24, 24], maxZoom: 16 });
}

function renderResults() {
  const filtered = filteredLocations();
  renderDirectory(filtered);
  pins.clearLayers();
  markers.clear();

  const points: L.LatLngTuple[] = [];
  for (const location of filtered) {
    if (location.latitude === null || location.longitude === null) continue;
    const point: L.LatLngTuple = [location.latitude, location.longitude];
    const title = `${location.id}. ${location.name}`;
    const marker = L.marker(point, {
      title,
      alt: title,
      icon: L.divIcon({ html: pinNumber(location), className: 'map-pin', iconSize: [32, 32], iconAnchor: [16, 16] }),
    }).bindPopup(() => popupContent(location), { maxWidth: 260 }).addTo(pins);
    markers.set(location.id, marker);
    points.push(point);
  }
  fitPins(points);

  const activeCount = data.locations.filter((location) => location.active).length;
  summary.textContent = filtersActive()
    ? `${filtered.length} of ${activeCount} places match`
    : `${activeCount} places`;
  clearFilters.hidden = !filtersActive();
  status.textContent = loadingMessage || data.warning || '';
}

function renderInactive() {
  const inactive = data.locations.filter((location) => !location.active);
  inactiveSection.hidden = inactive.length === 0;
  inactiveList.replaceChildren(...inactive.map((location) => {
    const item = element('li', undefined,
      textElement('strong', `#${location.id} ${location.name}`),
      ` — ${location.inactiveReason ?? 'Waiting for verification.'}`);
    if (location.phone) item.append(' Call ', link(telHref(location.phone), location.phone), ' for current locations.');
    return item;
  }));
}

function renderData(result: MapData) {
  data = result;
  categoryById = new Map(data.categories.map((category) => [category.id, category]));
  for (const categoryId of [...selectedCategories]) {
    if (!categoryById.has(categoryId)) selectedCategories.delete(categoryId);
  }
  review.replaceChildren(...data.locations.map((location) => {
    const row = document.createElement('tr');
    for (const value of [location.id, location.name, location.fullAddress, location.active ? location.matchedAddress : 'Inactive — not mapped', location.latitude, location.longitude]) {
      row.append(textElement('td', value === null || value === '' ? '—' : String(value)));
    }
    return row;
  }));
  renderFilters();
  renderInactive();
  renderResults();
}

// ---- Map / list view (phones show one at a time) ----

function setView(view: 'map' | 'list') {
  app.dataset.view = view;
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.viewButton === view));
  if (view === 'map') {
    map.invalidateSize();
    if (pendingBounds) fitPins(pendingBounds);
  }
}

function clearAllFilters() {
  selectedCategories.clear();
  selectedNeeds.clear();
  search.value = '';
  renderFilters();
  renderResults();
}

function ensureVisible(id: number) {
  const location = data.locations.find((candidate) => candidate.id === id);
  if (location && !locationMatches(location, searchTerm())) clearAllFilters();
}

function focusMarker(id: number) {
  ensureVisible(id);
  setView('map');
  const marker = markers.get(id);
  if (!marker) return;
  if (!WIDE_LAYOUT.matches) controls.scrollIntoView({ behavior: scrollBehavior() });
  else mapElement.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16));
  marker.openPopup();
}

function showDetails(id: number) {
  ensureVisible(id);
  setView('list');
  map.closePopup();
  openDetails.add(id);
  const card = document.getElementById(`location-${id}`);
  if (!card) return;
  card.querySelector('details')!.open = true;
  card.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  card.querySelector<HTMLHeadingElement>('h3')?.focus({ preventScroll: true });
}

// Keep cards from scrolling underneath the sticky controls on phones.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--controls-height', `${controls.offsetHeight}px`);
}).observe(controls);

// ---- Data loading ----

async function requestMapData(path: string, method = 'GET'): Promise<MapData> {
  const response = await fetch(path, { method, headers: method === 'POST' ? { 'X-Map-Request': '1' } : {} });
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  return response.json();
}

async function loadStaticData(path: string) {
  // The Cloudflare build has no server: data and coordinates come from a prebuilt file.
  refresh.hidden = true;
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
    renderData(await response.json());
  } catch (error) {
    console.error(error);
    data.warning = 'Could not load locations. Please check your connection and reload.';
  }
  status.textContent = data.warning ?? '';
}

async function updateLocations(forceRefresh = false) {
  refresh.disabled = true;
  loadingMessage = forceRefresh ? 'Refreshing address matches…' : 'Loading…';
  status.textContent = loadingMessage;
  try {
    if (!forceRefresh) {
      const result = await requestMapData('/api/locations');
      loadingMessage = result.needsGeocoding ? 'Finding addresses on the map…' : '';
      renderData(result);
      if (!loadingMessage) return;
    }
    const result = await requestMapData(forceRefresh ? '/api/regeocode' : '/api/geocode', 'POST');
    loadingMessage = '';
    renderData(result);
  } catch (error) {
    console.error(error);
    data.warning = 'Could not load updated locations. Please try again later.';
  } finally {
    loadingMessage = '';
    status.textContent = data.warning ?? '';
    refresh.disabled = false;
  }
}

search.addEventListener('input', () => {
  renderFilters();
  renderResults();
});
search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search.blur(); // Close the phone keyboard to reveal results.
});
clearFilters.addEventListener('click', () => {
  clearAllFilters();
  search.focus();
});
for (const button of viewButtons) {
  button.addEventListener('click', () => setView(button.dataset.viewButton as 'map' | 'list'));
}
WIDE_LAYOUT.addEventListener('change', () => setView(app.dataset.view === 'list' ? 'list' : 'map'));
refresh.addEventListener('click', () => void updateLocations(true));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-show-location]')) {
  button.addEventListener('click', () => {
    button.closest('details')?.removeAttribute('open');
    focusMarker(Number(button.dataset.showLocation));
  });
}
if (app.dataset.staticData) void loadStaticData(app.dataset.staticData);
else void updateLocations();
