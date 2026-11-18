import type { Category, CostType, Location, Service, ServiceGroup } from './types.js';

const CITY_SUFFIX = 'Niagara Falls, NY, USA';
const COST_TYPES: CostType[] = ['free', 'paid', 'insurance', 'unknown'];

type Raw = Record<string, unknown>;

class DirectoryError extends Error {}

function fail(where: string, message: string): never {
  throw new DirectoryError(`data/locations.json, ${where}: ${message}`);
}

function object(value: unknown, where: string): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'expected an object');
  return value as Raw;
}

function list(value: unknown, where: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(where, 'expected a list in [ ]');
  return value;
}

function text(value: unknown, where: string, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) fail(where, 'is required');
    return undefined;
  }
  if (typeof value !== 'string') fail(where, 'expected text in quotes');
  return value.trim() || undefined;
}

function texts(value: unknown, where: string): string[] {
  return list(value, where).map((item, index) => text(item, `${where}[${index}]`, true)!);
}

/** Reads and checks the directory file so editing mistakes produce a clear message. */
export function parseDirectory(json: string): { categories: Category[]; locations: Location[] } {
  let root: Raw;
  try {
    root = object(JSON.parse(json), 'top level');
  } catch (error) {
    if (error instanceof DirectoryError) throw error;
    throw new DirectoryError(`data/locations.json is not valid JSON: ${(error as Error).message}`);
  }

  const categories = list(root.categories, 'categories').map((value, index): Category => {
    const raw = object(value, `categories[${index}]`);
    const where = `category ${String(raw.id ?? index)}`;
    const name = text(raw.name, `${where} name`, true)!;
    return {
      id: text(raw.id, `${where} id`, true)!,
      name,
      short: text(raw.short, `${where} short`) ?? name,
      icon: text(raw.icon, `${where} icon`) ?? '•',
      color: text(raw.color, `${where} color`) ?? '#37474F',
      needs: texts(raw.needs, `${where} needs`),
    };
  });
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  if (categoryById.size !== categories.length) fail('categories', 'two categories share the same id');

  const checkCategories = (ids: string[], where: string) => {
    for (const id of ids) if (!categoryById.has(id)) fail(where, `unknown category "${id}"`);
    return ids;
  };

  const seenIds = new Set<number>();
  const locations = list(root.locations, 'locations').map((value, index): Location => {
    const raw = object(value, `locations[${index}]`);
    const id = raw.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) fail(`locations[${index}]`, 'id must be a whole number');
    if (seenIds.has(id)) fail(`location #${id}`, 'another location already uses this id');
    seenIds.add(id);
    const where = `location #${id}`;
    const streetAddress = text(raw.address, `${where} address`, true)!;
    const geocodeQuery = text(raw.geocodeQuery, `${where} geocodeQuery`);

    const serviceGroups = list(raw.serviceGroups, `${where} serviceGroups`).map((groupValue, groupIndex): ServiceGroup => {
      const group = object(groupValue, `${where} serviceGroups[${groupIndex}]`);
      const groupWhere = `${where} group "${String(group.title ?? groupIndex)}"`;
      const groupCategories = checkCategories(texts(group.categories, `${groupWhere} categories`), groupWhere);
      return {
        title: text(group.title, `${groupWhere} title`, true)!,
        services: list(group.services, `${groupWhere} services`).map((serviceValue, serviceIndex): Service => {
          if (typeof serviceValue === 'string') {
            return { name: text(serviceValue, `${groupWhere} services[${serviceIndex}]`, true)!, categories: groupCategories, needs: [] };
          }
          const service = object(serviceValue, `${groupWhere} services[${serviceIndex}]`);
          const serviceWhere = `${where} service "${String(service.name ?? serviceIndex)}"`;
          const serviceCategories = service.categories === undefined
            ? groupCategories
            : checkCategories(texts(service.categories, `${serviceWhere} categories`), serviceWhere);
          const needs = texts(service.needs, `${serviceWhere} needs`);
          for (const need of needs) {
            if (!serviceCategories.some((categoryId) => categoryById.get(categoryId)!.needs.includes(need))) {
              fail(serviceWhere, `need "${need}" is not listed under any of this service's categories`);
            }
          }
          return {
            name: text(service.name, `${serviceWhere} name`, true)!,
            hours: text(service.hours, `${serviceWhere} hours`),
            limitedTo: text(service.limitedTo, `${serviceWhere} limitedTo`),
            categories: serviceCategories,
            needs,
          };
        }),
      };
    });

    const cost = raw.cost === undefined ? { type: 'unknown' as const } : (() => {
      const rawCost = object(raw.cost, `${where} cost`);
      const type = text(rawCost.type, `${where} cost type`, true) as CostType;
      if (!COST_TYPES.includes(type)) fail(`${where} cost type`, `must be one of ${COST_TYPES.join(', ')}`);
      return { type, note: text(rawCost.note, `${where} cost note`) };
    })();

    if (raw.active !== undefined && typeof raw.active !== 'boolean') fail(`${where} active`, 'must be true or false');

    return {
      id,
      name: text(raw.name, `${where} name`, true)!,
      active: raw.active !== false,
      inactiveReason: text(raw.inactiveReason, `${where} inactiveReason`),
      streetAddress,
      fullAddress: `${streetAddress}, ${CITY_SUFFIX}`,
      lookupAddress: `${geocodeQuery ?? streetAddress}, ${CITY_SUFFIX}`,
      phone: text(raw.phone, `${where} phone`),
      phoneNote: text(raw.phoneNote, `${where} phoneNote`),
      otherPhones: list(raw.otherPhones, `${where} otherPhones`).map((phoneValue, phoneIndex) => {
        const phone = object(phoneValue, `${where} otherPhones[${phoneIndex}]`);
        return {
          label: text(phone.label, `${where} otherPhones[${phoneIndex}] label`, true)!,
          number: text(phone.number, `${where} otherPhones[${phoneIndex}] number`, true)!,
        };
      }),
      categories: checkCategories(texts(raw.categories, `${where} categories`), where),
      hours: text(raw.hours, `${where} hours`),
      cost,
      eligibility: text(raw.eligibility, `${where} eligibility`),
      access: text(raw.access, `${where} access`),
      documents: text(raw.documents, `${where} documents`),
      websites: texts(raw.websites, `${where} websites`),
      lastVerified: text(raw.lastVerified, `${where} lastVerified`),
      notes: texts(raw.notes, `${where} notes`),
      serviceGroups,
    };
  });

  return { categories, locations };
}
