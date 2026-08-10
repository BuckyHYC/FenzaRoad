export interface TitleDefinition {
  id: string;
  name: string;
  kills: number;
  color: string;
  description: string;
}

export const TITLES: TitleDefinition[] = [
  {
    id: 'rookie',
    name: '初露锋芒',
    kills: 10,
    color: '#8ce99a',
    description: '累计撞倒 10 名行人',
  },
  {
    id: 'street-hunter',
    name: '街头猎手',
    kills: 20,
    color: '#5ec8ff',
    description: '累计撞倒 20 名行人',
  },
  {
    id: 'racer-king',
    name: '飙车王者',
    kills: 30,
    color: '#ffb84d',
    description: '累计撞倒 30 名行人',
  },
  {
    id: 'god-driver',
    name: '车神降世',
    kills: 40,
    color: '#ff7ad9',
    description: '累计撞倒 40 名行人',
  },
  {
    id: 'road-demon',
    name: '暴走车魔',
    kills: 50,
    color: '#ff4d5e',
    description: '累计撞倒 50 名行人',
  },
];
