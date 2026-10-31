import { Router, Request, Response } from 'express';
import {
  getOverviewMetrics,
  getWeeklyReport,
  getMonthlyReport,
  getLeaderboard,
  getHostProfile,
  getPartyHistory,
  exportPartiesCSV,
  exportLeaderboardCSV,
  getRecentActivity,
  getPartyDetails,
} from '../services/analyticsService';
import { getBotProfile } from '../services/discordUserService';
import { logger } from '../../utils/logger';

export const apiRouter = Router();

// Health Check
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'discord-raid-master',
    timestamp: new Date().toISOString(),
  });
});

// Authenticated Discord User / Bot Context
apiRouter.get('/api/user-context', (_req: Request, res: Response) => {
  try {
    const profile = getBotProfile();
    res.json({
      ...profile,
      unreadNotifications: 3,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/user-context');
    res.status(500).json({ error: 'Failed to fetch user context.' });
  }
});

// Real Chronological Activity Timeline
apiRouter.get('/api/analytics/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '10', 10) || 10;
    const data = await getRecentActivity(limit);
    res.json(data);
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/analytics/activity');
    res.status(500).json({ error: 'Failed to fetch activity.' });
  }
});

// Overview Metrics
apiRouter.get('/api/analytics/overview', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'week';
    if (!['week', 'month', 'all'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period parameter. Use "week", "month", or "all".' });
    }
    const data = await getOverviewMetrics(period as 'week' | 'month' | 'all');
    res.json(data);
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/analytics/overview');
    res.status(500).json({ error: 'Failed to fetch overview metrics.' });
  }
});

// Weekly Report
apiRouter.get('/api/reports/weekly', async (req: Request, res: Response) => {
  try {
    const offset = parseInt((req.query.offset as string) || '0', 10) || 0;
    const data = await getWeeklyReport(offset);
    res.json(data);
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/reports/weekly');
    res.status(500).json({ error: 'Failed to fetch weekly report.' });
  }
});

// Monthly Report
apiRouter.get('/api/reports/monthly', async (req: Request, res: Response) => {
  try {
    const offset = parseInt((req.query.offset as string) || '0', 10) || 0;
    const data = await getMonthlyReport(offset);
    res.json(data);
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/reports/monthly');
    res.status(500).json({ error: 'Failed to fetch monthly report.' });
  }
});

// Leaderboard
apiRouter.get('/api/leaderboard', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'all';
    const type = (req.query.type as string) || 'hosted';
    const page = parseInt((req.query.page as string) || '1', 10) || 1;
    const limit = parseInt((req.query.limit as string) || '20', 10) || 20;
    const search = req.query.search as string | undefined;

    if (!['week', 'month', 'all'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period. Use "week", "month", or "all".' });
    }

    if (!['hosted', 'joined'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type. Use "hosted" or "joined".' });
    }

    const data = await getLeaderboard(period as 'week' | 'month' | 'all', page, limit, search, type as 'hosted' | 'joined');
    res.json(data);
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/leaderboard');
    res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
});

// Host Profile
apiRouter.get('/api/hosts/:userId', async (req: Request, res: Response) => {
  try {
    const rawParam = req.params.userId;
    const userId = (Array.isArray(rawParam) ? rawParam[0] : rawParam) || '';
    if (!userId || !userId.trim()) {
      return res.status(400).json({ error: 'Host user ID is required.' });
    }
    const data = await getHostProfile(userId.trim());
    res.json(data);
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/hosts/:userId');
    res.status(500).json({ error: 'Failed to fetch host profile.' });
  }
});

// Searchable Party History
apiRouter.get('/api/parties', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const host = req.query.host as string | undefined;
    const activity = req.query.activity as string | undefined;
    const status = req.query.status as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const page = parseInt((req.query.page as string) || '1', 10) || 1;
    const limit = parseInt((req.query.limit as string) || '20', 10) || 20;
    const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc';

    const data = await getPartyHistory({
      search,
      host,
      activity,
      status,
      startDate,
      endDate,
      page,
      limit,
      sortOrder,
    });
    res.json(data);
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/parties');
    res.status(500).json({ error: 'Failed to fetch party history.' });
  }
});

// Party Details by ID
apiRouter.get('/api/parties/:id', async (req: Request, res: Response) => {
  try {
    const rawParam = req.params.id;
    const id = (Array.isArray(rawParam) ? rawParam[0] : rawParam) || '';
    if (!id || !id.trim()) {
      return res.status(400).json({ error: 'Party ID is required.' });
    }
    const data = await getPartyDetails(id.trim());
    if (!data) {
      return res.status(404).json({ error: 'Party not found.' });
    }
    res.json(data);
  } catch (error: any) {
    logger.error({ error }, 'Error in /api/parties/:id');
    res.status(500).json({ error: 'Failed to fetch party details.' });
  }
});

// CSV Export: Parties
apiRouter.get('/api/export/parties.csv', async (req: Request, res: Response) => {
  try {
    const activity = req.query.activity as string | undefined;
    const status = req.query.status as string | undefined;
    const where: any = {};
    if (activity && activity !== 'ALL') where.activityType = activity;
    if (status && status !== 'ALL') where.status = status;

    const csvData = await exportPartiesCSV(where);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tracking_parties.csv"');
    res.send(csvData);
  } catch (error: any) {
    logger.error({ error }, 'Error exporting parties CSV');
    res.status(500).send('Failed to generate parties CSV.');
  }
});

// CSV Export: Leaderboard
apiRouter.get('/api/export/leaderboard.csv', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as 'week' | 'month' | 'all') || 'all';
    const type = (req.query.type as 'hosted' | 'joined') || 'hosted';
    const csvData = await exportLeaderboardCSV(period, type);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_leaderboard_${period}.csv"`);
    res.send(csvData);
  } catch (error: any) {
    logger.error({ error }, 'Error exporting leaderboard CSV');
    res.status(500).send('Failed to generate leaderboard CSV.');
  }
});
