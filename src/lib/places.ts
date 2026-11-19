// Where an incident happened, read from the provider's own words: cloud region codes, region names,
// data-centre cities and airport codes. Broad areas ("Europe", "US") get an approximate pin.
export interface Place { name: string; lat: number; lon: number; approx?: boolean }

const P = (name: string, lat: number, lon: number, approx = false): Place => ({ name, lat, lon, approx });
const NVA = P('N. Virginia', 38.9, -77.4), OHIO = P('Ohio', 40.0, -83.0), NCAL = P('N. California', 37.4, -122.0),
    OREGON = P('Oregon', 45.6, -121.2), IOWA = P('Iowa', 41.3, -95.9), SCAR = P('South Carolina', 33.2, -80.0),
    LA = P('Los Angeles', 34.05, -118.25), MONTREAL = P('Montréal', 45.5, -73.6), TORONTO = P('Toronto', 43.7, -79.4),
    DUBLIN = P('Ireland', 53.35, -6.26), LONDON = P('London', 51.5, -0.12), PARIS = P('Paris', 48.86, 2.35),
    FRANKFURT = P('Frankfurt', 50.11, 8.68), STOCKHOLM = P('Stockholm', 59.33, 18.07), MILAN = P('Milan', 45.46, 9.19),
    AMSTERDAM = P('Amsterdam', 52.37, 4.9), BELGIUM = P('Belgium', 50.45, 3.82), FINLAND = P('Finland', 60.57, 27.19),
    MADRID = P('Madrid', 40.42, -3.7), ZURICH = P('Zürich', 47.37, 8.54), WARSAW = P('Warsaw', 52.23, 21.01),
    MUMBAI = P('Mumbai', 19.08, 72.88), CHENNAI = P('Chennai', 13.08, 80.27), BANGALORE = P('Bengaluru', 12.97, 77.59), PUNE = P('Pune', 18.52, 73.86), DELHI = P('Delhi', 28.61, 77.21),
    SINGAPORE = P('Singapore', 1.35, 103.82), JAKARTA = P('Jakarta', -6.2, 106.85), HONGKONG = P('Hong Kong', 22.32, 114.17),
    TOKYO = P('Tokyo', 35.68, 139.69), OSAKA = P('Osaka', 34.69, 135.5), SEOUL = P('Seoul', 37.57, 126.98), TAIWAN = P('Taiwan', 24.15, 120.67),
    SYDNEY = P('Sydney', -33.87, 151.21), MELBOURNE = P('Melbourne', -37.81, 144.96), SAOPAULO = P('São Paulo', -23.55, -46.63),
    CAPETOWN = P('Cape Town', -33.92, 18.42), JOHANNESBURG = P('Johannesburg', -26.2, 28.05), BAHRAIN = P('Bahrain', 26.07, 50.56),
    DUBAI = P('Dubai', 25.2, 55.27), TELAVIV = P('Tel Aviv', 32.09, 34.78), NEWYORK = P('New York', 40.71, -74.0), NEWARK = P('Newark', 40.74, -74.17),
    CHICAGO = P('Chicago', 41.88, -87.63), DALLAS = P('Dallas', 32.78, -96.8), ATLANTA = P('Atlanta', 33.75, -84.39), SEATTLE = P('Seattle', 47.61, -122.33),
    MIAMI = P('Miami', 25.76, -80.19), SANJOSE = P('San Jose', 37.34, -121.89), SANFRANCISCO = P('San Francisco', 37.77, -122.42), DENVER = P('Denver', 39.74, -104.99),
    PHOENIX = P('Phoenix', 33.45, -112.07), MEXICO = P('Mexico City', 19.43, -99.13), BOGOTA = P('Bogotá', 4.71, -74.07), SANTIAGO = P('Santiago', -33.45, -70.67),
    BUENOSAIRES = P('Buenos Aires', -34.6, -58.38), LAGOS = P('Lagos', 6.52, 3.38), NAIROBI = P('Nairobi', -1.29, 36.82), ISTANBUL = P('Istanbul', 41.01, 28.98);

// Exact tokens (case-sensitive where noted): cloud region codes first, they're the most precise.
const CODES: [RegExp, Place][] = [
    // AWS
    [/\bus-east-1\b/, NVA], [/\bus-east-2\b/, OHIO], [/\bus-west-1\b/, NCAL], [/\bus-west-2\b/, OREGON], [/\bca-central-1\b/, MONTREAL],
    [/\beu-west-1\b/, DUBLIN], [/\beu-west-2\b/, LONDON], [/\beu-west-3\b/, PARIS], [/\beu-central-1\b/, FRANKFURT], [/\beu-central-2\b/, ZURICH],
    [/\beu-north-1\b/, STOCKHOLM], [/\beu-south-1\b/, MILAN], [/\beu-south-2\b/, MADRID], [/\bap-south-1\b/, MUMBAI], [/\bap-south-2\b/, P('Hyderabad', 17.39, 78.49)],
    [/\bap-southeast-1\b/, SINGAPORE], [/\bap-southeast-2\b/, SYDNEY], [/\bap-southeast-3\b/, JAKARTA], [/\bap-southeast-4\b/, MELBOURNE],
    [/\bap-northeast-1\b/, TOKYO], [/\bap-northeast-2\b/, SEOUL], [/\bap-northeast-3\b/, OSAKA], [/\bap-east-1\b/, HONGKONG], [/\bsa-east-1\b/, SAOPAULO],
    [/\bme-south-1\b/, BAHRAIN], [/\bme-central-1\b/, DUBAI], [/\baf-south-1\b/, CAPETOWN], [/\bil-central-1\b/, TELAVIV],
    // Google Cloud
    [/\bus-central1\b/, IOWA], [/\bus-east1\b/, SCAR], [/\bus-east4\b/, NVA], [/\bus-east5\b/, OHIO], [/\bus-south1\b/, DALLAS], [/\bus-west1\b/, OREGON],
    [/\bus-west2\b/, LA], [/\bus-west3\b/, P('Salt Lake City', 40.76, -111.89)], [/\bus-west4\b/, P('Las Vegas', 36.17, -115.14)],
    [/\bnorthamerica-northeast1\b/, MONTREAL], [/\bnorthamerica-northeast2\b/, TORONTO], [/\bsouthamerica-east1\b/, SAOPAULO], [/\bsouthamerica-west1\b/, SANTIAGO],
    [/\beurope-west1\b/, BELGIUM], [/\beurope-west2\b/, LONDON], [/\beurope-west3\b/, FRANKFURT], [/\beurope-west4\b/, P('Netherlands', 53.44, 6.84)],
    [/\beurope-west6\b/, ZURICH], [/\beurope-west8\b/, MILAN], [/\beurope-west9\b/, PARIS], [/\beurope-southwest1\b/, MADRID], [/\beurope-north1\b/, FINLAND],
    [/\beurope-central2\b/, WARSAW], [/\basia-east1\b/, TAIWAN], [/\basia-east2\b/, HONGKONG], [/\basia-northeast1\b/, TOKYO], [/\basia-northeast2\b/, OSAKA],
    [/\basia-northeast3\b/, SEOUL], [/\basia-south1\b/, MUMBAI], [/\basia-south2\b/, DELHI], [/\basia-southeast1\b/, SINGAPORE], [/\basia-southeast2\b/, JAKARTA],
    [/\baustralia-southeast1\b/, SYDNEY], [/\baustralia-southeast2\b/, MELBOURNE], [/\bme-west1\b/, TELAVIV], [/\bafrica-south1\b/, JOHANNESBURG],
    // DigitalOcean datacentres
    [/\bNYC[1-3]\b/, NEWYORK], [/\bSFO[1-3]\b/, SANFRANCISCO], [/\bAMS[2-3]\b/, AMSTERDAM], [/\bSGP1\b/, SINGAPORE], [/\bLON1\b/, LONDON],
    [/\bFRA1\b/, FRANKFURT], [/\bTOR1\b/, TORONTO], [/\bBLR1\b/, BANGALORE], [/\bSYD1\b/, SYDNEY], [/\bATL1\b/, ATLANTA],
    // Azure region names
    [/\bEast US 2\b/i, P('Virginia (East US 2)', 36.67, -78.39)], [/\bEast US(?! 2)\b/i, NVA], [/\bWest US 3\b/i, PHOENIX], [/\bWest US 2\b/i, P('Washington state', 47.23, -119.85)],
    [/\bWest US(?! [23])\b/i, NCAL], [/\bCentral US\b/i, IOWA], [/\bSouth Central US\b/i, P('Texas', 29.42, -98.49)], [/\bNorth Europe\b/i, DUBLIN], [/\bWest Europe\b/i, AMSTERDAM],
    [/\bUK South\b/i, LONDON], [/\bFrance Central\b/i, PARIS], [/\bGermany West Central\b/i, FRANKFURT], [/\bSoutheast Asia\b/i, SINGAPORE], [/\bEast Asia\b/i, HONGKONG],
    [/\bJapan East\b/i, TOKYO], [/\bAustralia East\b/i, SYDNEY], [/\bCentral India\b/i, PUNE], [/\bBrazil South\b/i, SAOPAULO],
    // Airport codes, upper case only (Cloudflare and Fly.io use them)
    [/\bIAD\b/, NVA], [/\bEWR\b/, NEWARK], [/\bORD\b/, CHICAGO], [/\bDFW\b/, DALLAS], [/\bLAX\b/, LA], [/\bSJC\b/, SANJOSE], [/\bSEA\b/, SEATTLE], [/\bATL\b/, ATLANTA],
    [/\bMIA\b/, MIAMI], [/\bDEN\b/, DENVER], [/\bYYZ\b/, TORONTO], [/\bGRU\b/, SAOPAULO], [/\bLHR\b/, LONDON], [/\bCDG\b/, PARIS], [/\bFRA\b/, FRANKFURT],
    [/\bAMS\b/, AMSTERDAM], [/\bARN\b/, STOCKHOLM], [/\bMAD\b/, MADRID], [/\bWAW\b/, WARSAW], [/\bSIN\b/, SINGAPORE], [/\bNRT\b/, TOKYO], [/\bHKG\b/, HONGKONG],
    [/\bSYD\b/, SYDNEY], [/\bBOM\b/, MUMBAI], [/\bJNB\b/, JOHANNESBURG], [/\bDXB\b/, DUBAI], [/\bKIX\b/, OSAKA], [/\bICN\b/, SEOUL], [/\bMXP\b/, MILAN],
];

// City and country names, case-insensitive.
const NAMES: [RegExp, Place][] = [
    ...([['Frankfurt', FRANKFURT], ['London', LONDON], ['Paris', PARIS], ['Amsterdam', AMSTERDAM], ['Dublin', DUBLIN], ['Stockholm', STOCKHOLM], ['Madrid', MADRID],
        ['Milan', MILAN], ['Zurich', ZURICH], ['Warsaw', WARSAW], ['Mumbai', MUMBAI], ['Chennai', CHENNAI], ['Bangalore', BANGALORE], ['Bengaluru', BANGALORE],
        ['Singapore', SINGAPORE], ['Jakarta', JAKARTA], ['Hong Kong', HONGKONG], ['Tokyo', TOKYO], ['Osaka', OSAKA], ['Seoul', SEOUL], ['Sydney', SYDNEY],
        ['Melbourne', MELBOURNE], ['Sao Paulo', SAOPAULO], ['São Paulo', SAOPAULO], ['Johannesburg', JOHANNESBURG], ['Cape Town', CAPETOWN], ['Dubai', DUBAI],
        ['Tel Aviv', TELAVIV], ['New York', NEWYORK], ['Newark', NEWARK], ['Chicago', CHICAGO], ['Dallas', DALLAS], ['Atlanta', ATLANTA], ['Seattle', SEATTLE],
        ['Miami', MIAMI], ['San Jose', SANJOSE], ['San Francisco', SANFRANCISCO], ['Los Angeles', LA], ['Denver', DENVER], ['Toronto', TORONTO], ['Montreal', MONTREAL],
        ['Mexico City', MEXICO], ['Bogota', BOGOTA], ['Santiago', SANTIAGO], ['Buenos Aires', BUENOSAIRES], ['Lagos', LAGOS], ['Nairobi', NAIROBI], ['Istanbul', ISTANBUL],
        ['Fremont', P('Fremont', 37.55, -121.99)], ['Ashburn', NVA], ['Portland', P('Portland', 45.52, -122.68)]] as [string, Place][])
        .map(([n, p]) => [new RegExp(`\\b${n}\\b`, 'i'), p] as [RegExp, Place]),
];

// Broad areas, approximate.
const AREAS: [RegExp, Place][] = [
    [/\b(Europe|EU|EMEA)\b/, P('Europe', 50, 10, true)], [/\b(APAC|Asia[- ]Pacific|Asia)\b/i, P('Asia-Pacific', 15, 110, true)],
    [/\bIndia\b/i, P('India', 21, 78, true)], [/\bJapan\b/i, P('Japan', 36, 138, true)], [/\bAustralia\b/i, P('Australia', -25, 134, true)],
    [/\bBrazil\b/i, P('Brazil', -12, -50, true)], [/\b(Latin America|LATAM|South America)\b/i, P('Latin America', -15, -60, true)],
    [/\b(Africa)\b/i, P('Africa', 5, 20, true)], [/\b(Middle East)\b/i, P('Middle East', 26, 47, true)], [/\bCanada\b/i, P('Canada', 52, -100, true)],
    [/\b(United Kingdom|UK)\b/, P('United Kingdom', 53, -2, true)], [/\bGermany\b/i, P('Germany', 51, 10, true)],
    [/\b(US|U\.S\.|United States|North America)\b/, P('United States', 39, -98, true)],
];

/** Every distinct place mentioned, most precise first. Empty means "global or not stated". */
export function findPlaces(text: string): Place[] {
    const out: Place[] = [];
    const add = (p: Place) => { if (!out.some(o => o.name === p.name)) out.push(p); };
    for (const [re, p] of CODES) if (re.test(text)) add(p);
    for (const [re, p] of NAMES) if (re.test(text)) add(p);
    if (!out.length) for (const [re, p] of AREAS) if (re.test(text)) add(p);
    return out.slice(0, 6);
}
