import type { User, EventSummary, PointOfInterest, EventDay } from './types'

export const MOCK_USERS: User[] = [
  { id: '1', name: 'Mike Johnson', email: 'mike.j@paramedic.app', role: 'paramedic', unit: 'Unit 1', status: 'active', joined: '2024-01-15', phone: '+1 555-0101' },
  { id: '2', name: 'Sarah Davis', email: 'sarah.d@paramedic.app', role: 'paramedic', unit: 'Unit 2', status: 'active', joined: '2024-02-20', phone: '+1 555-0102' },
  { id: '3', name: 'Alex Thompson', email: 'alex.t@paramedic.app', role: 'emt', unit: 'Unit 1', status: 'active', joined: '2024-01-10', phone: '+1 555-0103' },
  { id: '4', name: 'Emma Wilson', email: 'emma.w@paramedic.app', role: 'paramedic', unit: 'Unit 3', status: 'active', joined: '2024-03-05', phone: '+1 555-0104' },
  { id: '5', name: 'Daniel Brown', email: 'daniel.b@paramedic.app', role: 'emt', unit: 'Unit 2', status: 'active', joined: '2024-02-28', phone: '+1 555-0105' },
  { id: '6', name: 'Lisa Martinez', email: 'lisa.m@paramedic.app', role: 'doctor', unit: 'Unit 1', status: 'active', joined: '2023-12-01', phone: '+1 555-0106' },
  { id: '7', name: 'James Wilson', email: 'james.w@paramedic.app', role: 'coordinator', unit: 'Unit 1', status: 'active', joined: '2023-11-15', phone: '+1 555-0107' },
  { id: '8', name: 'Anna Schmidt', email: 'anna.s@paramedic.app', role: 'paramedic', unit: 'Unit 3', status: 'active', joined: '2024-04-01', phone: '+1 555-0108' },
  { id: '9', name: 'Robert Chen', email: 'robert.c@paramedic.app', role: 'emt', unit: 'Unit 2', status: 'inactive', joined: '2024-01-22', phone: '+1 555-0109' },
  { id: '10', name: 'Sophie Laurent', email: 'sophie.l@paramedic.app', role: 'paramedic', unit: 'Unit 1', status: 'active', joined: '2024-03-18', phone: '+1 555-0110' },
  { id: '11', name: 'Carlos Rivera', email: 'carlos.r@paramedic.app', role: 'emt', unit: 'Unit 3', status: 'active', joined: '2024-02-14', phone: '+1 555-0111' },
  { id: '12', name: 'Nina Petrov', email: 'nina.p@paramedic.app', role: 'doctor', unit: 'Unit 2', status: 'active', joined: '2023-10-30', phone: '+1 555-0112' },
  { id: '13', name: 'Tom Harris', email: 'tom.h@paramedic.app', role: 'paramedic', unit: 'Unit 1', status: 'active', joined: '2024-04-12', phone: '+1 555-0113' },
  { id: '14', name: 'Maria Gonzalez', email: 'maria.g@paramedic.app', role: 'emt', unit: 'Unit 2', status: 'active', joined: '2024-01-08', phone: '+1 555-0114' },
  { id: '15', name: 'David Kim', email: 'david.k@paramedic.app', role: 'coordinator', unit: 'Unit 3', status: 'inactive', joined: '2023-09-20', phone: '+1 555-0115' },
]

export const MOCK_EVENTS: EventSummary[] = [
  {
    id: 'ev-1',
    title: 'Iron Peak Marathon 2025',
    status: 'draft',
    dates: [new Date('2025-06-14'), new Date('2025-06-15')],
    location: 'Bansko, Bulgaria',
    disciplines: 4,
    medics: 32,
    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
  },
  {
    id: 'ev-2',
    title: 'Alpine Challenge 2025',
    status: 'active',
    dates: [new Date('2025-07-20'), new Date('2025-07-21')],
    location: 'Rila Mountains, Bulgaria',
    disciplines: 3,
    medics: 24,
    image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
  },
  {
    id: 'ev-3',
    title: 'Trail Blaze Ultra 2025',
    status: 'closed',
    dates: [new Date('2025-04-05'), new Date('2025-04-06')],
    location: 'Vitosha, Sofia',
    disciplines: 2,
    medics: 18,
  },
]

export const MOCK_POIS: PointOfInterest[] = [
  { id: 'p1', type: 'base-medical-camp', coordinates: [23.472, 41.852], name: 'Base Medical Camp' },
  { id: 'p2', type: 'ambulance', coordinates: [23.495, 41.838], name: 'Ambulance' },
  { id: 'p3', type: 'medical-point', coordinates: [23.488, 41.825], name: 'Medical Point A' },
  { id: 'p4', type: 'medical-point', coordinates: [23.481, 41.861], name: 'Medical Point B' },
  { id: 'p5', type: 'water-point', coordinates: [23.465, 41.843], name: 'Water Point 1' },
  { id: 'p6', type: 'water-point', coordinates: [23.501, 41.832], name: 'Water Point 2' },
  { id: 'p7', type: 'wc', coordinates: [23.478, 41.856], name: 'WC 1' },
  { id: 'p8', type: 'wc', coordinates: [23.503, 41.848], name: 'WC 2' },
  { id: 'p9', type: 'parking', coordinates: [23.469, 41.831], name: 'Parking A' },
  { id: 'p10', type: 'parking', coordinates: [23.512, 41.840], name: 'Parking B' },
  { id: 'p11', type: 'wardrobe', coordinates: [23.484, 41.845] },
]

export const MOCK_DAYS: EventDay[] = [
  {
    id: 'day-1',
    date: new Date('2025-06-14'),
    disciplines: [
      { id: 'd1', name: 'Trail Run 21 km', type: 'trail-run', distance: 21.2, elevation: 1230, color: '#8b5cf6', gpxFile: 'trail_run_21k.gpx', gpxUploaded: true },
      { id: 'd2', name: 'Trail Run 10 km', type: 'trail-run', distance: 10.5, elevation: 620, color: '#3b82f6', gpxFile: 'trail_run_10k.gpx', gpxUploaded: true },
    ],
    pois: [],
    assignments: [],
  },
  {
    id: 'day-2',
    date: new Date('2025-06-15'),
    disciplines: [
      { id: 'd3', name: 'MTB 45 km', type: 'mtb', distance: 45.3, elevation: 1850, color: '#22c55e', gpxFile: 'mtb_45k.gpx', gpxUploaded: true },
      { id: 'd4', name: 'Marathon 42 km', type: 'marathon', distance: 42.2, elevation: 2400, color: '#f97316', gpxFile: 'marathon_42k.gpx', gpxUploaded: true },
      { id: 'd5', name: 'Run 5 km', type: 'run', distance: 5.0, elevation: 120, color: '#14b8a6', gpxFile: 'run_5k.gpx', gpxUploaded: true },
    ],
    pois: [],
    assignments: [],
  },
]

export function generateElevationProfile(points = 100, baseElev = 800, maxElevGain = 1200) {
  return Array.from({ length: points }, (_, i) => {
    const t = i / points
    const elevation =
      baseElev +
      Math.sin(t * Math.PI * 2.5) * maxElevGain * 0.4 +
      Math.sin(t * Math.PI * 5) * maxElevGain * 0.15 +
      Math.sin(t * Math.PI * 9) * maxElevGain * 0.05
    return {
      distance: parseFloat((t * 21.2).toFixed(2)),
      elevation: Math.round(elevation),
    }
  })
}
