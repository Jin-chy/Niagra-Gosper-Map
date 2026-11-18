export interface Category {
  id: string;
  name: string;
  /** Short label for filter chips; defaults to name. */
  short: string;
  icon: string;
  color: string;
  /** Specific needs users can filter by within this category. */
  needs: string[];
}

export interface Service {
  name: string;
  hours?: string;
  /** Who can use the service when it is not open to the public. */
  limitedTo?: string;
  categories: string[];
  needs: string[];
}

export interface ServiceGroup {
  title: string;
  services: Service[];
}

export type CostType = 'free' | 'paid' | 'insurance' | 'unknown';

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** The geocoder's description of the match, for checking the pin. */
  matchedAddress?: string;
  /** The address that was looked up. When it no longer matches, the location is looked up again. */
  lookupAddress?: string;
}

export interface Location {
  id: number;
  name: string;
  active: boolean;
  inactiveReason?: string;
  streetAddress: string;
  fullAddress: string;
  /** The address sent to the geocoder; differs from fullAddress only when geocodeQuery is set. */
  lookupAddress: string;
  phone?: string;
  phoneNote?: string;
  otherPhones: { label: string; number: string }[];
  categories: string[];
  hours?: string;
  cost: { type: CostType; note?: string };
  eligibility?: string;
  access?: string;
  documents?: string;
  websites: string[];
  lastVerified?: string;
  notes: string[];
  serviceGroups: ServiceGroup[];
  coordinates?: Coordinates;
}

/** A location as the page receives it: numbered, with only what the page needs. */
export type SiteLocation = Omit<Location, 'lookupAddress' | 'coordinates'> & {
  /** Display number, 1, 2, 3… across active locations with no gaps. */
  pin?: number;
  coordinates?: { latitude: number; longitude: number };
};

export interface SiteData {
  categories: Category[];
  locations: SiteLocation[];
}
