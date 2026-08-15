import { DEFAULT_VEHICLE_ID, VEHICLES } from './Constants';
import type { DailyState, PlayerStats } from './types';

/**
 * 留存系统配置与纯函数：
 * 金币经济、成就、每日挑战、连续签到。
 * 所有可变的存档数据都存放在 GameState.saved 中，本模块只提供
 * 定义、派生进度与日期相关的纯计算，便于测试与复用。
 */

export const VEHICLE_PRICES: Record<string, number> = {
  sedan: 0,
  taxi: 500,
  pickup: 900,
  suv: 1800,
  police: 2800,
  coupe: 4000,
};

export function vehiclePrice(vehicleId: string): number {
  return VEHICLE_PRICES[vehicleId] ?? 0;
}

export const RACE_REWARDS = [300, 200, 150];
export const RACE_DNF_REWARD = 60;
export const KILL_COIN_REWARD = 5;
export const DISTANCE_COIN_EVERY_KM = 2; // 每行驶 1 km 获得 2 金币

/** 签到奖励：第 n 天获得 n*50，封顶 300 */
export function checkInReward(streak: number): number {
  return Math.min(300, Math.max(1, streak) * 50);
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** 进度来源：统计字段 / 行人击杀 / 连续签到 */
  stat: keyof PlayerStats | 'kills' | 'streak';
  target: number;
  reward: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'drive-10', name: '老司机', description: '累计驾驶 10 km', icon: '🚗', stat: 'distanceKm', target: 10, reward: 100 },
  { id: 'drive-100', name: '环城百公里', description: '累计驾驶 100 km', icon: '🛣️', stat: 'distanceKm', target: 100, reward: 500 },
  { id: 'endless-50', name: '无尽探索者', description: '无尽模式累计行驶 50 km', icon: '🌌', stat: 'endlessKm', target: 50, reward: 400 },
  { id: 'race-1', name: '初登赛道', description: '完成 1 场竞速', icon: '🏁', stat: 'races', target: 1, reward: 150 },
  { id: 'race-10', name: '赛事常客', description: '完成 10 场竞速', icon: '🏆', stat: 'races', target: 10, reward: 400 },
  { id: 'win-1', name: '首胜', description: '赢得 1 场竞速', icon: '🥇', stat: 'raceWins', target: 1, reward: 300 },
  { id: 'win-5', name: '五冠王', description: '赢得 5 场竞速', icon: '👑', stat: 'raceWins', target: 5, reward: 800 },
  { id: 'speed-180', name: '追风少年', description: '极速达到 180 km/h', icon: '💨', stat: 'topSpeedKmh', target: 180, reward: 200 },
  { id: 'speed-220', name: '极速传说', description: '极速达到 220 km/h', icon: '🚀', stat: 'topSpeedKmh', target: 220, reward: 400 },
  { id: 'kill-5', name: '行人克星', description: '撞倒 5 名行人', icon: '🚶', stat: 'kills', target: 5, reward: 80 },
  { id: 'kill-25', name: '街头噩梦', description: '撞倒 25 名行人', icon: '💀', stat: 'kills', target: 25, reward: 300 },
  { id: 'earn-5000', name: '小金库', description: '累计赚取 5000 金币', icon: '🪙', stat: 'coinsEarned', target: 5000, reward: 500 },
  { id: 'streak-3', name: '三日之约', description: '连续签到 3 天', icon: '📅', stat: 'streak', target: 3, reward: 200 },
  { id: 'streak-7', name: '签到狂魔', description: '连续签到 7 天', icon: '🔥', stat: 'streak', target: 7, reward: 600 },
];

export interface DailyChallengeDef {
  id: 'drive' | 'race' | 'kills' | 'endless';
  name: string;
  description: string;
  target: number;
  unit: string;
  reward: number;
}

export const DAILY_CHALLENGE_POOL: Record<
  DailyChallengeDef['id'],
  { name: string; description: (target: number) => string; unit: string }
> = {
  drive: {
    name: '城市巡游',
    description: (target) => `累计驾驶 ${target} km`,
    unit: 'km',
  },
  race: {
    name: '竞速挑战',
    description: (target) => `完成 ${target} 场竞速`,
    unit: '场',
  },
  kills: {
    name: '行人克星',
    description: (target) => `撞倒 ${target} 名行人`,
    unit: '人',
  },
  endless: {
    name: '无尽之旅',
    description: (target) => `无尽模式行驶 ${target} km`,
    unit: 'km',
  },
};

/** 本地日期键（YYYY-MM-DD），每日挑战与签到都以此为准 */
export function dateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 前一天日期键，用于签到连续天数判断 */
export function yesterdayKey(today = new Date()): string {
  const copy = new Date(today);
  copy.setDate(copy.getDate() - 1);
  return dateKey(copy);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** 按日期确定性生成 3 个每日任务：巡游 + 竞速 + （击杀 或 无尽） */
export function dailyChallengesFor(date = new Date()): DailyChallengeDef[] {
  const key = dateKey(date);
  const h = hashString(`moron-daily-${key}`);
  const driveTarget = [5, 8, 12][h % 3];
  const raceTarget = [1, 2][(h >> 2) % 2];
  const killsTarget = [5, 8, 12][(h >> 4) % 3];
  const endlessTarget = [3, 5, 8][(h >> 6) % 3];
  const third =
    ((h >> 8) % 2 === 0)
      ? {
          id: 'kills' as const,
          target: killsTarget,
          reward: 150,
        }
      : {
          id: 'endless' as const,
          target: endlessTarget,
          reward: 150,
        };
  const defs: { id: DailyChallengeDef['id']; target: number; reward: number }[] = [
    { id: 'drive', target: driveTarget, reward: 120 },
    { id: 'race', target: raceTarget, reward: 160 },
    third,
  ];
  return defs.map((def) => {
    const pool = DAILY_CHALLENGE_POOL[def.id];
    return {
      id: def.id,
      name: pool.name,
      description: pool.description(def.target),
      target: def.target,
      unit: pool.unit,
      reward: def.reward,
    };
  });
}

export interface ProgressContext {
  stats: PlayerStats;
  pedestrianKills: number;
  checkInStreak: number;
}

export function achievementProgress(
  achievement: AchievementDef,
  context: ProgressContext,
): number {
  if (achievement.stat === 'kills') return context.pedestrianKills;
  if (achievement.stat === 'streak') return context.checkInStreak;
  return context.stats[achievement.stat] ?? 0;
}

export function challengeProgress(
  def: DailyChallengeDef,
  context: ProgressContext,
): number {
  switch (def.id) {
    case 'drive':
      return context.stats.distanceKm;
    case 'race':
      return context.stats.races;
    case 'kills':
      return context.pedestrianKills;
    case 'endless':
      return context.stats.endlessKm;
    default:
      return 0;
  }
}

export function isDailyFresh(daily: DailyState): boolean {
  return daily.date !== dateKey();
}

export function canCheckIn(daily: DailyState): boolean {
  return daily.checkInDate !== dateKey();
}

/** 领签到后的新 streak 与奖励 */
export function applyCheckIn(daily: DailyState): { streak: number; reward: number } {
  const today = dateKey();
  if (daily.checkInDate === today) {
    return { streak: daily.checkInStreak, reward: 0 };
  }
  const streak = daily.checkInDate === yesterdayKey() ? daily.checkInStreak + 1 : 1;
  return { streak, reward: checkInReward(streak) };
}

export function defaultStats(): PlayerStats {
  return {
    distanceKm: 0,
    endlessKm: 0,
    races: 0,
    raceWins: 0,
    topSpeedKmh: 0,
    playSeconds: 0,
    coinsEarned: 0,
  };
}

export function defaultDaily(): DailyState {
  return {
    date: '',
    done: [],
    checkInDate: '',
    checkInStreak: 0,
  };
}

export function defaultOwnedVehicleIds(selectedVehicleId: string): string[] {
  const ids = [DEFAULT_VEHICLE_ID];
  if (selectedVehicleId !== DEFAULT_VEHICLE_ID && VEHICLES.some((v) => v.id === selectedVehicleId)) {
    ids.push(selectedVehicleId);
  }
  return ids;
}
