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
} from '../services/analyticsService';
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
    const page = parseInt((req.query.page as string) || '1', 10) || 1;
    const limit = parseInt((req.query.limit as string) || '20', 10) || 20;
    const search = req.query.search as string | undefined;

    if (!['week', 'month', 'all'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period. Use "week", "month", or "all".' });
    }

    const data = await getLeaderboard(period as 'week' | 'month' | 'all', page, limit, search);
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
    const csvData = await exportLeaderboardCSV(period);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="host_leaderboard_${period}.csv"`);
    res.send(csvData);
  } catch (error: any) {
    logger.error({ error }, 'Error exporting leaderboard CSV');
    res.status(500).send('Failed to generate leaderboard CSV.');
  }
});
