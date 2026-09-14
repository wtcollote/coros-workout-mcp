export interface TrainingDailyMetric {
  date: string;
  avgSleepHrv: number | null;
  hrvBaseline: number | null;
  restingHeartRate: number | null;
  trainingLoad: number | null;
  trainingLoadRatio: number | null;
  fatigueRate: number | null;
  acuteTrainingIndex: number | null;
  chronicTrainingIndex: number | null;
  performance: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  vo2max: number | null;
  lactateThresholdHeartRate: number | null;
  lactateThresholdPace: number | null;
  fitnessLevel: number | null;
  fitnessLevel7d: number | null;
}

export interface TrainingActivitySummary {
  activityId: string;
  date: string;
  name: string | null;
  sportType: number | null;
  sportName: string | null;
  startTime: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  averageHeartRate: number | null;
  maximumHeartRate: number | null;
  calories: number | null;
  trainingLoad: number | null;
  averagePower: number | null;
  normalizedPower: number | null;
  elevationGain: number | null;
}
