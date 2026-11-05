import { Header } from '../Header';
import { VehiclePanel } from './VehiclePanel';
import { VehicleCharts } from './VehicleCharts';
import { VehicleSide } from './VehicleSide';
import { useVehicleSimDriver } from './sim';

/** Vehicle mode shell: same header, car designer left, charts centre, KPIs / optimiser / accuracy right. */
export function VehicleView() {
  useVehicleSimDriver();
  return (
    <div className="app vehicle-app" data-testid="vehicle-mode">
      <Header />
      <VehiclePanel />
      <VehicleCharts />
      <VehicleSide />
    </div>
  );
}
