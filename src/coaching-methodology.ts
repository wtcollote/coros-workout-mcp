export type MethodCategory = "foundation" | "periodization" | "intensity_distribution" | "session_method" | "strength" | "recovery" | "environment" | "monitoring";
export type EvidenceStatus = "established" | "context_dependent" | "emerging" | "historical";

export interface CoachingMethod {
  id: string;
  name: string;
  category: MethodCategory;
  evidenceStatus: EvidenceStatus;
  historicalContext: string;
  currentUse: string;
  sports: string[];
  phases: string[];
  selectionSignals: string[];
  cautions: string[];
}

export const COACHING_KNOWLEDGE_VERSION = "2026.09";
export const COACHING_KNOWLEDGE_LAST_REVIEWED = "2026-09-04";

export const COACHING_METHODS: CoachingMethod[] = [
  {
    id: "specific_progressive_overload", name: "Specific progressive overload", category: "foundation", evidenceStatus: "established",
    historicalContext: "A foundational training principle developed across classical conditioning and periodization practice.",
    currentUse: "Increase only the dose the athlete can absorb, then verify adaptation in sport-specific performance and recovery.",
    sports: ["all"], phases: ["base", "build", "specific"],
    selectionSignals: ["stable recovery", "consistent completion", "tolerated recent load"],
    cautions: ["Load is multidimensional: volume, intensity, impact, elevation, density and strength stress must not be collapsed into one number."],
  },
  {
    id: "continuous_aerobic_base", name: "Continuous aerobic endurance", category: "session_method", evidenceStatus: "established",
    historicalContext: "Long steady distance is one of the oldest systematic endurance methods.",
    currentUse: "Build aerobic capacity, economy and durability at sustainable intensity; duration and terrain should progress individually.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance"], phases: ["base", "build", "specific"],
    selectionSignals: ["need for aerobic volume", "low-intensity durability objective", "adequate musculoskeletal tolerance"],
    cautions: ["Long is relative to the athlete; excessive duration can impair recovery without adding useful specificity."],
  },
  {
    id: "interval_training", name: "Interval training", category: "session_method", evidenceStatus: "established",
    historicalContext: "Formal interval methods were prominent in early twentieth-century running and later adopted across endurance sports.",
    currentUse: "Manipulate work duration, intensity, recovery and repetition count to target VO2 kinetics, threshold, economy or neuromuscular qualities.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance"], phases: ["base", "build", "specific"],
    selectionSignals: ["clear physiological or event-specific target", "adequate recovery", "repeatable execution quality"],
    cautions: ["The label HIIT is insufficient; the work-to-rest design and accumulated time at the intended stimulus determine the session."],
  },
  {
    id: "traditional_periodization", name: "Traditional periodization", category: "periodization", evidenceStatus: "historical",
    historicalContext: "Classical models progress from general preparation toward more specific and intense work before competition.",
    currentUse: "Useful as a planning scaffold when the athlete has a stable calendar and a clear target event.",
    sports: ["all"], phases: ["base", "build", "specific", "taper"],
    selectionSignals: ["single main objective", "predictable training availability", "long preparation horizon"],
    cautions: ["Real adaptation is not linear; the plan must change when response, health or life constraints change."],
  },
  {
    id: "block_periodization", name: "Block periodization", category: "periodization", evidenceStatus: "context_dependent",
    historicalContext: "Concentrated loading blocks evolved from periodization systems designed for advanced athletes and complex competition calendars.",
    currentUse: "Concentrate compatible stimuli for a limited period while maintaining other qualities with minimum effective doses.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance", "multisport"], phases: ["build", "specific"],
    selectionSignals: ["experienced athlete", "specific limiter", "sufficient recovery and monitoring"],
    cautions: ["Concentrated stress can exceed tolerance; it is not automatically superior to mixed training."],
  },
  {
    id: "polarized_distribution", name: "Polarized intensity distribution", category: "intensity_distribution", evidenceStatus: "context_dependent",
    historicalContext: "The model formalized observations of high low-intensity volume with a smaller amount of high-intensity work in endurance athletes.",
    currentUse: "Separate easy and hard work clearly when that distribution fits the athlete, phase and event demands.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance"], phases: ["base", "build"],
    selectionSignals: ["adequate weekly frequency", "need to protect easy volume", "good high-intensity tolerance"],
    cautions: ["Zone definitions and session-count versus time-in-zone methods change the apparent distribution; it is not universally best."],
  },
  {
    id: "pyramidal_distribution", name: "Pyramidal intensity distribution", category: "intensity_distribution", evidenceStatus: "context_dependent",
    historicalContext: "A descriptive distribution with most work easy, less moderate work and the least high-intensity work.",
    currentUse: "Often compatible with long-event specificity and progressive threshold development while retaining dominant easy volume.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance"], phases: ["base", "build", "specific"],
    selectionSignals: ["event includes sustained moderate work", "athlete tolerates tempo/threshold", "sufficient easy-volume discipline"],
    cautions: ["Moderate work can accumulate hidden fatigue when every easy session drifts upward."],
  },
  {
    id: "threshold_block", name: "Threshold-focused training", category: "intensity_distribution", evidenceStatus: "context_dependent",
    historicalContext: "Tempo and threshold work have long been used to improve sustainable speed or power.",
    currentUse: "Use bounded blocks or sessions around a measured threshold when sustainable performance is a relevant limiter.",
    sports: ["cycling", "running", "trail_running"], phases: ["build", "specific"],
    selectionSignals: ["reliable threshold estimate", "specific sustained-intensity demand", "stable recovery"],
    cautions: ["Frequent threshold work is costly and sensitive to incorrect zones; avoid turning the entire week into medium-hard training."],
  },
  {
    id: "ultra_durability", name: "Ultra-endurance durability and specificity", category: "session_method", evidenceStatus: "context_dependent",
    historicalContext: "Long outings and back-to-back sessions arose from the practical need to prepare for fatigue resistance and event logistics.",
    currentUse: "Rehearse sustainable pacing, fueling, equipment, stops, terrain and late-session decision making with the minimum effective recovery cost.",
    sports: ["ultra_endurance", "trail_running", "cycling"], phases: ["build", "specific"],
    selectionSignals: ["long-event objective", "established base", "need to test execution under fatigue"],
    cautions: ["Back-to-back and very long sessions are tools, not weekly obligations; injury and recovery cost can outweigh specificity."],
  },
  {
    id: "trail_eccentric_technical", name: "Trail climbing, descending and technical skill", category: "session_method", evidenceStatus: "context_dependent",
    historicalContext: "Mountain-running practice has always separated climbing capacity and descending skill from flat running speed.",
    currentUse: "Develop uphill economy, hiking transitions, technical footwork and progressive eccentric tolerance for descents.",
    sports: ["trail_running", "ultra_endurance"], phases: ["base", "build", "specific"],
    selectionSignals: ["vertical or technical event", "descent soreness or skill limiter", "terrain access"],
    cautions: ["Elevation gain alone does not quantify technical or eccentric load; introduce descent volume gradually."],
  },
  {
    id: "heavy_strength_endurance", name: "Heavy strength integrated with endurance", category: "strength", evidenceStatus: "established",
    historicalContext: "Strength work moved from general conditioning toward targeted maximal-force, economy and robustness support.",
    currentUse: "Use low-to-moderate volume, high-quality strength selected for the athlete's sport, history and constraints, then sequence it around key endurance work.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance", "multisport"], phases: ["base", "build", "specific", "maintenance"],
    selectionSignals: ["strength or economy limiter", "injury-tolerance objective", "space for recovery"],
    cautions: ["Heart rate does not measure muscular stress; record exercises, sets, repetitions, resistance and effort. Avoid unfamiliar damaging work near priority events."],
  },
  {
    id: "taper", name: "Event-specific taper", category: "recovery", evidenceStatus: "established",
    historicalContext: "Pre-competition load reduction evolved from coaching practice and was refined through taper research.",
    currentUse: "Reduce fatigue while retaining enough intensity and frequency to preserve event-specific readiness.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance"], phases: ["taper"],
    selectionSignals: ["priority event approaching", "completed specific preparation", "accumulated fatigue"],
    cautions: ["Magnitude and duration depend on prior load, event type and athlete response; abrupt complete rest is not a universal taper."],
  },
  {
    id: "autoregulation", name: "Daily autoregulation", category: "monitoring", evidenceStatus: "context_dependent",
    historicalContext: "Coaches have long adjusted training from observation and athlete feedback; wearables add signals but do not replace that process.",
    currentUse: "Combine subjective state, pain/illness, sleep, HRV/RHR trends, recent work and warm-up response to preserve or modify session purpose.",
    sports: ["all"], phases: ["all"],
    selectionSignals: ["daily decision", "variable life stress", "usable baseline and athlete feedback"],
    cautions: ["Do not react to one noisy wearable value or manufacture a universal readiness score."],
  },
  {
    id: "heat_acclimation", name: "Heat acclimation", category: "environment", evidenceStatus: "established",
    historicalContext: "Progressive heat exposure has long been used before hot-weather competition.",
    currentUse: "Introduce controlled heat exposure progressively while monitoring hydration, cardiovascular strain and recovery.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance"], phases: ["specific"],
    selectionSignals: ["hot event forecast", "sufficient preparation time", "safe monitoring environment"],
    cautions: ["Heat adds training stress; medical risks and medications require appropriate professional oversight."],
  },
  {
    id: "fueling_gut_training", name: "Fueling and gut training", category: "foundation", evidenceStatus: "context_dependent",
    historicalContext: "Race feeding progressed from ad-hoc intake to planned carbohydrate, fluid and sodium strategies tested in training.",
    currentUse: "Practice event-specific intake, product combinations, timing and tolerance during representative sessions.",
    sports: ["cycling", "running", "trail_running", "ultra_endurance"], phases: ["build", "specific"],
    selectionSignals: ["sessions beyond roughly 90 minutes", "ultra objective", "history of late fade or GI issues"],
    cautions: ["Needs are individual and environmental; avoid inferring sweat or sodium loss without measurement."],
  },
];

export function getCoachingMethodologyCatalog(filters: { sport?: string; category?: MethodCategory; evidenceStatus?: EvidenceStatus } = {}): Record<string, unknown> {
  const methods = COACHING_METHODS.filter((method) => {
    if (filters.sport && !method.sports.includes("all") && !method.sports.includes(filters.sport)) return false;
    if (filters.category && method.category !== filters.category) return false;
    if (filters.evidenceStatus && method.evidenceStatus !== filters.evidenceStatus) return false;
    return true;
  });
  return {
    knowledgeVersion: COACHING_KNOWLEDGE_VERSION,
    lastEvidenceReview: COACHING_KNOWLEDGE_LAST_REVIEWED,
    methods,
    governance: {
      evidenceLabels: {
        established: "Broadly supported principle or method; dose and application still require individualization.",
        context_dependent: "Useful in defined circumstances; evidence or superiority is not universal.",
        emerging: "Promising but not mature enough for default prescription.",
        historical: "Historically influential framework retained as context, not treated as proof of current superiority.",
      },
      updatePolicy: "Review new methods against peer-reviewed evidence, consensus, replication, practical relevance and risk before changing default coaching behavior.",
      noveltyPolicy: "Novelty is never treated as effectiveness. Emerging practices remain labeled and cannot override safety, specificity or observed athlete response.",
    },
  };
}

export function selectRelevantCoachingMethods(sport: string, phase?: string): CoachingMethod[] {
  return COACHING_METHODS.filter((method) => {
    const sportMatch = method.sports.includes("all") || method.sports.includes(sport);
    const phaseMatch = !phase || phase === "unknown" || method.phases.includes("all") || method.phases.includes(phase);
    return sportMatch && phaseMatch;
  });
}
