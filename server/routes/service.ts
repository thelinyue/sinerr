import { getSettings } from '@server/lib/settings';
import { Router } from 'express';

interface ServiceMoviePilotServer {
  id: number;
  name: string;
  isDefault: boolean;
}

const serviceRoutes = Router();

serviceRoutes.get('/moviepilot', async (req, res) => {
  const settings = getSettings();

  const filteredServers: ServiceMoviePilotServer[] = settings.moviepilot.map(
    (mp) => ({
      id: mp.id,
      name: mp.name,
      isDefault: mp.isDefault,
    })
  );

  return res.status(200).json(filteredServers);
});

export default serviceRoutes;
