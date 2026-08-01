import { getSettings } from '@server/lib/settings';
import { Router } from 'express';

interface ServiceServer {
  id: number;
  name: string;
  isDefault: boolean;
}

const serviceRoutes = Router();

serviceRoutes.get('/moviepilot', async (req, res) => {
  const settings = getSettings();

  const filteredServers: ServiceServer[] = settings.moviepilot.map((mp) => ({
    id: mp.id,
    name: mp.name,
    isDefault: mp.isDefault,
  }));

  return res.status(200).json(filteredServers);
});

serviceRoutes.get('/mediary', async (req, res) => {
  const settings = getSettings();

  const filteredServers: ServiceServer[] = settings.mediary.map((m) => ({
    id: m.id,
    name: m.name,
    isDefault: m.isDefault,
  }));

  return res.status(200).json(filteredServers);
});

export default serviceRoutes;
