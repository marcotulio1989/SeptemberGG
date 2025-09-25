import * as _ from 'lodash';
import * as collision from '../generic_modules/collision';
import * as math from '../generic_modules/math';
import * as util from '../generic_modules/utility';
import { config } from './config';
import type { Segment, ZoneName } from './mapgen';
import { getZoneAt } from './mapgen';
import type Quadtree from '../lib/quadtree';

export enum BuildingType {
    RESIDENTIAL = "residential",
    IMPORT = "import",
    HOUSE = "house",
    // Residencial detalhado
    HOUSE_SMALL = "houseSmall",
    HOUSE_HIGH = "houseHigh",
    APARTMENT_BLOCK = "apartmentBlock",
    CONDO_TOWER = "condoTower",
    SCHOOL = "school",
    LEISURE = "leisureArea",
    COMMERCIAL = "commercial", // legado (loja genérica)
    COMMERCIAL_MEDIUM = "commercialMedium",
    COMMERCIAL_LARGE = "commercialLarge",
    // Comercial detalhado
    SHOP_SMALL = "shopSmall",
    KIOSK = "kiosk",
    BAKERY = "bakery",
    RESTAURANT = "restaurant",
    BAR = "bar",
    PHARMACY = "pharmacy",
    GROCERY = "grocery",
    SUPERMARKET = "supermarket",
    SHOPPING_CENTER = "shoppingCenter",
    OFFICE = "office",
    HOTEL = "hotel",
    CONVENTION_CENTER = "conventionCenter",
    CINEMA = "cinema",
    HOSPITAL_PRIVATE = "hospitalPrivate",
    CLINIC = "clinic",
    PUBLIC_OFFICE = "publicOffice",
    PARKING = "parkingLot",
    GAS_STATION = "gasStation",
    BANK = "bank",
    PARK = "park",
    GREEN = "green",
    CHURCH = "church",
    FACTORY = "factory",
    // Industrial detalhado
    WAREHOUSE_SMALL = "warehouseSmall",
    FACTORY_MEDIUM = "factoryMedium",
    INDUSTRIAL_COMPLEX = "industrialComplex",
    DISTRIBUTION_CENTER = "distributionCenter",
    WORKSHOP = "workshop",
    POWER_PLANT = "powerPlant",
    FARM = "farm",
    // Rural detalhado
    FARMHOUSE = "farmhouse",
    SILO = "silo",
    ANIMAL_BARN = "animalBarn",
    MACHINERY_SHED = "machineryShed",
    COOPERATIVE = "cooperative",
    FIELD = "field",
    POND = "pond",
    STREET_TREE = "streetTree",
    TREE_CLUSTER = "treeCluster",
    LAMP_POST = "lampPost",
    TRASH_BIN = "trashBin",
    BENCH = "bench",
}

export class Building {
    static id_counter = 0;
    id: number;
    aspectDegree: number;
    corners: math.Point[];
    collider: collision.CollisionObject;
    supply: any[] = [];
    demand: any[] = [];

    constructor(
        public center: math.Point,
        public dir: number,
        public diagonal: number,
        public type: BuildingType,
        aspectRatio: number = 1
    ) {
        this.aspectDegree = math.atanDegrees(aspectRatio);
        this.corners = this.generateCorners();
        this.collider = new collision.CollisionObject(this, collision.CollisionObjectType.RECT, { corners: this.corners });
        this.id = Building.id_counter++;
    }

    generateCorners(): math.Point[] {
        return [
            { x: this.center.x + this.diagonal * math.sinDegrees(+this.aspectDegree + this.dir), y: this.center.y + this.diagonal * math.cosDegrees(+this.aspectDegree + this.dir) },
            { x: this.center.x + this.diagonal * math.sinDegrees(-this.aspectDegree + this.dir),  y: this.center.y + this.diagonal * math.cosDegrees(-this.aspectDegree + this.dir) },
            { x: this.center.x + this.diagonal * math.sinDegrees(180 + this.aspectDegree + this.dir), y: this.center.y + this.diagonal * math.cosDegrees(180 + this.aspectDegree + this.dir) },
            { x: this.center.x + this.diagonal * math.sinDegrees(180 - this.aspectDegree + this.dir), y: this.center.y + this.diagonal * math.cosDegrees(180 - this.aspectDegree + this.dir) }
        ];
    }

    setCenter(val: math.Point): void {
        this.center = val;
        this.corners = this.generateCorners();
        this.collider.updateCollisionProperties({ corners: this.corners });
    }

    setDir(val: number): void {
        this.dir = val;
        this.corners = this.generateCorners();
        this.collider.updateCollisionProperties({ corners: this.corners });
    }
}

// usar o ZoneName exportado de mapgen (inclui 'downtown')

export const buildingFactory = {
    fromProbability(time: number): Building {
        const r = Math.random();
        if (r < 0.2) return this.byType(BuildingType.IMPORT, time);
        if (r < 0.6) return this.byType(BuildingType.RESIDENTIAL, time);
        return this.byType(BuildingType.HOUSE, time);
    },

    fromZone(zone: ZoneName, time: number): Building {
        const mix = (config as any).zones?.[zone]?.buildingMix || {};
        // Whitelists por zona
        const allowByZone: Record<ZoneName, Array<keyof typeof mix>> = {
            downtown: [
                'shoppingCenter','office','hotel','office','conventionCenter','cinema','hospitalPrivate','clinic','publicOffice',
                'commercialLarge','commercialMedium','commercial','supermarket','grocery','restaurant','bakery','bar','pharmacy','shopSmall','kiosk',
                'bank','parkingLot','gasStation','residential','house','park','green','church','streetTree','treeCluster','lampPost','trashBin','bench'
            ] as any,
            commercial: [
                'kiosk','shopSmall','bakery','bar','pharmacy','grocery','restaurant','supermarket','shoppingCenter','office','hotel','parkingLot',
                'bank','gasStation','commercial','commercialMedium','commercialLarge','cinema','clinic','hospitalPrivate','publicOffice','conventionCenter',
                // Residencial leve permitido na comercial
                'residential','houseSmall','house','apartmentBlock','streetTree','treeCluster','lampPost','trashBin','bench'
            ] as any,
            residential: [
                'houseSmall','house','houseHigh','apartmentBlock','condoTower','school','leisureArea',
                'park','green','church','clinic','streetTree','treeCluster','lampPost','trashBin','bench'
            ] as any,
            industrial: [
                'workshop','warehouseSmall','factory','factoryMedium','distributionCenter','industrialComplex','powerPlant',
                'commercialMedium','streetTree','lampPost','trashBin','bench'
            ] as any,
            rural: [
                'farm','farmhouse','silo','animalBarn','machineryShed','cooperative','field','pond','streetTree','treeCluster','bench','trashBin'
            ] as any,
        } as any;
        const allowed = new Set((allowByZone as any)[zone] || []);
        const order: { t: BuildingType; k: string }[] = [
            // Residencial
            { t: BuildingType.HOUSE_SMALL, k: 'houseSmall' },
            { t: BuildingType.HOUSE, k: 'house' },
            { t: BuildingType.HOUSE_HIGH, k: 'houseHigh' },
            { t: BuildingType.APARTMENT_BLOCK, k: 'apartmentBlock' },
            { t: BuildingType.CONDO_TOWER, k: 'condoTower' },
            { t: BuildingType.SCHOOL, k: 'school' },
            { t: BuildingType.LEISURE, k: 'leisureArea' },
            { t: BuildingType.RESIDENTIAL, k: 'residential' },
            // Comercial
            { t: BuildingType.KIOSK, k: 'kiosk' },
            { t: BuildingType.BAKERY, k: 'bakery' },
            { t: BuildingType.SHOP_SMALL, k: 'shopSmall' },
            { t: BuildingType.RESTAURANT, k: 'restaurant' },
            { t: BuildingType.BAR, k: 'bar' },
            { t: BuildingType.PHARMACY, k: 'pharmacy' },
            { t: BuildingType.GROCERY, k: 'grocery' },
            { t: BuildingType.SUPERMARKET, k: 'supermarket' },
            { t: BuildingType.SHOPPING_CENTER, k: 'shoppingCenter' },
            { t: BuildingType.OFFICE, k: 'office' },
            { t: BuildingType.HOTEL, k: 'hotel' },
            { t: BuildingType.CONVENTION_CENTER, k: 'conventionCenter' },
            { t: BuildingType.CINEMA, k: 'cinema' },
            { t: BuildingType.HOSPITAL_PRIVATE, k: 'hospitalPrivate' },
            { t: BuildingType.CLINIC, k: 'clinic' },
            { t: BuildingType.PUBLIC_OFFICE, k: 'publicOffice' },
            { t: BuildingType.PARKING, k: 'parkingLot' },
            { t: BuildingType.COMMERCIAL, k: 'commercial' },
            { t: BuildingType.COMMERCIAL_MEDIUM, k: 'commercialMedium' },
            { t: BuildingType.COMMERCIAL_LARGE, k: 'commercialLarge' },
            { t: BuildingType.GAS_STATION, k: 'gasStation' },
            { t: BuildingType.BANK, k: 'bank' },
            // Áreas comuns
            { t: BuildingType.PARK, k: 'park' },
            { t: BuildingType.GREEN, k: 'green' },
            { t: BuildingType.STREET_TREE, k: 'streetTree' },
            { t: BuildingType.TREE_CLUSTER, k: 'treeCluster' },
            { t: BuildingType.LAMP_POST, k: 'lampPost' },
            { t: BuildingType.TRASH_BIN, k: 'trashBin' },
            { t: BuildingType.BENCH, k: 'bench' },
            { t: BuildingType.CHURCH, k: 'church' },
            { t: BuildingType.IMPORT, k: 'import' },
            // Industrial
            { t: BuildingType.WAREHOUSE_SMALL, k: 'warehouseSmall' },
            { t: BuildingType.FACTORY, k: 'factory' },
            { t: BuildingType.FACTORY_MEDIUM, k: 'factoryMedium' },
            { t: BuildingType.DISTRIBUTION_CENTER, k: 'distributionCenter' },
            { t: BuildingType.INDUSTRIAL_COMPLEX, k: 'industrialComplex' },
            { t: BuildingType.WORKSHOP, k: 'workshop' },
            { t: BuildingType.POWER_PLANT, k: 'powerPlant' },
            // Rural
            { t: BuildingType.FARM, k: 'farm' },
            { t: BuildingType.FARMHOUSE, k: 'farmhouse' },
            { t: BuildingType.SILO, k: 'silo' },
            { t: BuildingType.ANIMAL_BARN, k: 'animalBarn' },
            { t: BuildingType.MACHINERY_SHED, k: 'machineryShed' },
            { t: BuildingType.COOPERATIVE, k: 'cooperative' },
            { t: BuildingType.FIELD, k: 'field' },
            { t: BuildingType.POND, k: 'pond' },
        ];
        let r = Math.random();
        for (const { t, k } of order) {
            if (!allowed.has(k as any)) continue;
            const p = (mix as any)[k] ?? 0;
            if (r < p) return this.byType(t, time);
            r -= p;
        }
        return this.byType(BuildingType.HOUSE, time);
    },

    byType(type: BuildingType, time: number): Building {
    // Valor padrão para satisfazer o compilador; será sobrescrito nos casos abaixo
    const defW = config.buildings.dimensions.house.width;
    const defD = config.buildings.dimensions.house.depth;
    const defDiag = Math.hypot(defW, defD) / 2 * Math.sqrt(config.buildings.areaScale);
    let building: Building = new Building({ x: 0, y: 0 }, 0, defDiag, BuildingType.HOUSE, defW / defD);
        switch (type) {
            // === Residencial detalhado ===
            case BuildingType.RESIDENTIAL:
                {
                    const w = config.buildings.dimensions.residential.width;
                    const d = config.buildings.dimensions.residential.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.9, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.RESIDENTIAL, ar);
                }
                break;
            case BuildingType.HOUSE_SMALL:
                {
                    const w = (config.buildings as any).dimensions.houseSmall.width;
                    const d = (config.buildings as any).dimensions.houseSmall.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.92, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.HOUSE_SMALL, ar);
                }
                break;
            case BuildingType.HOUSE_HIGH:
                {
                    const w = (config.buildings as any).dimensions.houseHigh.width;
                    const d = (config.buildings as any).dimensions.houseHigh.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.HOUSE_HIGH, ar);
                }
                break;
            case BuildingType.APARTMENT_BLOCK:
                {
                    const w = (config.buildings as any).dimensions.apartmentBlock.width;
                    const d = (config.buildings as any).dimensions.apartmentBlock.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.06);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.APARTMENT_BLOCK, ar);
                }
                break;
            case BuildingType.CONDO_TOWER:
                {
                    const w = (config.buildings as any).dimensions.condoTower.width;
                    const d = (config.buildings as any).dimensions.condoTower.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.05);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.CONDO_TOWER, ar);
                }
                break;
            case BuildingType.SCHOOL:
                {
                    const w = (config.buildings as any).dimensions.school.width;
                    const d = (config.buildings as any).dimensions.school.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.SCHOOL, ar);
                }
                break;
            case BuildingType.LEISURE:
                {
                    const w = (config.buildings as any).dimensions.leisureArea.width;
                    const d = (config.buildings as any).dimensions.leisureArea.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.9, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.LEISURE, ar);
                }
                break;
            case BuildingType.IMPORT:
                {
                    const w = config.buildings.dimensions.import.width;
                    const d = config.buildings.dimensions.import.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.95, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.IMPORT, ar);
                }
                break;
            case BuildingType.COMMERCIAL:
                {
                    const w = config.buildings.dimensions.commercial.width;
                    const d = config.buildings.dimensions.commercial.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.95, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.COMMERCIAL, ar);
                }
                break;
            case BuildingType.COMMERCIAL_MEDIUM:
                {
                    const w = (config.buildings as any).dimensions.commercialMedium.width;
                    const d = (config.buildings as any).dimensions.commercialMedium.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.COMMERCIAL_MEDIUM, ar);
                }
                break;
            case BuildingType.COMMERCIAL_LARGE:
                {
                    const w = (config.buildings as any).dimensions.commercialLarge.width;
                    const d = (config.buildings as any).dimensions.commercialLarge.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.05);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.COMMERCIAL_LARGE, ar);
                }
                break;
            case BuildingType.SHOP_SMALL:
                {
                    const w = (config.buildings as any).dimensions.shopSmall.width;
                    const d = (config.buildings as any).dimensions.shopSmall.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.92, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.SHOP_SMALL, ar);
                }
                break;
            case BuildingType.KIOSK:
                {
                    const w = (config.buildings as any).dimensions.kiosk.width;
                    const d = (config.buildings as any).dimensions.kiosk.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.9, 1.12);
                    const ar = w / d * math.randomRange(0.85, 1.15);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.KIOSK, ar);
                }
                break;
            case BuildingType.BAKERY:
                {
                    const w = (config.buildings as any).dimensions.bakery.width;
                    const d = (config.buildings as any).dimensions.bakery.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.92, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.BAKERY, ar);
                }
                break;
            case BuildingType.RESTAURANT:
                {
                    const w = (config.buildings as any).dimensions.restaurant.width;
                    const d = (config.buildings as any).dimensions.restaurant.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.92, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.RESTAURANT, ar);
                }
                break;
            case BuildingType.BAR:
                {
                    const w = (config.buildings as any).dimensions.bar.width;
                    const d = (config.buildings as any).dimensions.bar.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.92, 1.12);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.BAR, ar);
                }
                break;
            case BuildingType.PHARMACY:
                {
                    const w = (config.buildings as any).dimensions.pharmacy.width;
                    const d = (config.buildings as any).dimensions.pharmacy.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.92, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.PHARMACY, ar);
                }
                break;
            case BuildingType.GROCERY:
                {
                    const w = (config.buildings as any).dimensions.grocery.width;
                    const d = (config.buildings as any).dimensions.grocery.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.94, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.GROCERY, ar);
                }
                break;
            case BuildingType.SUPERMARKET:
                {
                    const w = (config.buildings as any).dimensions.supermarket.width;
                    const d = (config.buildings as any).dimensions.supermarket.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.SUPERMARKET, ar);
                }
                break;
            case BuildingType.SHOPPING_CENTER:
                {
                    const w = (config.buildings as any).dimensions.shoppingCenter.width;
                    const d = (config.buildings as any).dimensions.shoppingCenter.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.98, 1.02);
                    const ar = w / d * math.randomRange(0.98, 1.02);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.SHOPPING_CENTER, ar);
                }
                break;
            case BuildingType.OFFICE:
                {
                    const w = (config.buildings as any).dimensions.office.width;
                    const d = (config.buildings as any).dimensions.office.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.95, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.OFFICE, ar);
                }
                break;
            case BuildingType.HOTEL:
                {
                    const w = (config.buildings as any).dimensions.hotel.width;
                    const d = (config.buildings as any).dimensions.hotel.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.95, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.HOTEL, ar);
                }
                break;
            case BuildingType.CONVENTION_CENTER:
                {
                    const w = (config.buildings as any).dimensions.conventionCenter.width;
                    const d = (config.buildings as any).dimensions.conventionCenter.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.98, 1.04);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.CONVENTION_CENTER, ar);
                }
                break;
            case BuildingType.CINEMA:
                {
                    const w = (config.buildings as any).dimensions.cinema.width;
                    const d = (config.buildings as any).dimensions.cinema.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.96, 1.06);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.CINEMA, ar);
                }
                break;
            case BuildingType.HOSPITAL_PRIVATE:
                {
                    const w = (config.buildings as any).dimensions.hospitalPrivate.width;
                    const d = (config.buildings as any).dimensions.hospitalPrivate.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.98, 1.04);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.HOSPITAL_PRIVATE, ar);
                }
                break;
            case BuildingType.CLINIC:
                {
                    const w = (config.buildings as any).dimensions.clinic.width;
                    const d = (config.buildings as any).dimensions.clinic.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.CLINIC, ar);
                }
                break;
            case BuildingType.PUBLIC_OFFICE:
                {
                    const w = (config.buildings as any).dimensions.publicOffice.width;
                    const d = (config.buildings as any).dimensions.publicOffice.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.PUBLIC_OFFICE, ar);
                }
                break;
            case BuildingType.GAS_STATION:
                {
                    const w = (config.buildings as any).dimensions.gasStation.width;
                    const d = (config.buildings as any).dimensions.gasStation.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.GAS_STATION, ar);
                }
                break;
            case BuildingType.BANK:
                {
                    const w = (config.buildings as any).dimensions.bank.width;
                    const d = (config.buildings as any).dimensions.bank.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.95, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.BANK, ar);
                }
                break;
            case BuildingType.PARK:
                {
                    const w = (config.buildings as any).dimensions.park.width;
                    const d = (config.buildings as any).dimensions.park.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.05);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.PARK, ar);
                }
                break;
            case BuildingType.GREEN:
                {
                    const w = (config.buildings as any).dimensions.green.width;
                    const d = (config.buildings as any).dimensions.green.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.9, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.GREEN, ar);
                }
                break;
            case BuildingType.CHURCH:
                {
                    const w = (config.buildings as any).dimensions.church.width;
                    const d = (config.buildings as any).dimensions.church.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.8, 1.2);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.CHURCH, ar);
                }
                break;
            case BuildingType.FACTORY:
                {
                    const w = (config.buildings as any).dimensions.factory.width;
                    const d = (config.buildings as any).dimensions.factory.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.FACTORY, ar);
                }
                break;
            case BuildingType.WAREHOUSE_SMALL:
                {
                    const w = (config.buildings as any).dimensions.warehouseSmall.width;
                    const d = (config.buildings as any).dimensions.warehouseSmall.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.WAREHOUSE_SMALL, ar);
                }
                break;
            case BuildingType.FACTORY_MEDIUM:
                {
                    const w = (config.buildings as any).dimensions.factoryMedium.width;
                    const d = (config.buildings as any).dimensions.factoryMedium.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.08);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.FACTORY_MEDIUM, ar);
                }
                break;
            case BuildingType.INDUSTRIAL_COMPLEX:
                {
                    const w = (config.buildings as any).dimensions.industrialComplex.width;
                    const d = (config.buildings as any).dimensions.industrialComplex.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.98, 1.02);
                    const ar = w / d * math.randomRange(0.98, 1.02);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.INDUSTRIAL_COMPLEX, ar);
                }
                break;
            case BuildingType.DISTRIBUTION_CENTER:
                {
                    const w = (config.buildings as any).dimensions.distributionCenter.width;
                    const d = (config.buildings as any).dimensions.distributionCenter.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.98, 1.04);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.DISTRIBUTION_CENTER, ar);
                }
                break;
            case BuildingType.WORKSHOP:
                {
                    const w = (config.buildings as any).dimensions.workshop.width;
                    const d = (config.buildings as any).dimensions.workshop.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.WORKSHOP, ar);
                }
                break;
            case BuildingType.POWER_PLANT:
                {
                    const w = (config.buildings as any).dimensions.powerPlant.width;
                    const d = (config.buildings as any).dimensions.powerPlant.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.98, 1.02);
                    const ar = w / d * math.randomRange(0.98, 1.02);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.POWER_PLANT, ar);
                }
                break;
            case BuildingType.HOUSE:
                {
                    const w = config.buildings.dimensions.house.width;
                    const d = config.buildings.dimensions.house.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.9, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.HOUSE, ar);
                }
                break;
            case BuildingType.FARM:
                {
                    const w = (config.buildings as any).dimensions.farm.width;
                    const d = (config.buildings as any).dimensions.farm.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.2);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.FARM, ar);
                }
                break;
            case BuildingType.FARMHOUSE:
                {
                    const w = (config.buildings as any).dimensions.farmhouse.width;
                    const d = (config.buildings as any).dimensions.farmhouse.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.9, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.FARMHOUSE, ar);
                }
                break;
            case BuildingType.SILO:
                {
                    const w = (config.buildings as any).dimensions.silo.width;
                    const d = (config.buildings as any).dimensions.silo.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.SILO, ar);
                }
                break;
            case BuildingType.ANIMAL_BARN:
                {
                    const w = (config.buildings as any).dimensions.animalBarn.width;
                    const d = (config.buildings as any).dimensions.animalBarn.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.ANIMAL_BARN, ar);
                }
                break;
            case BuildingType.MACHINERY_SHED:
                {
                    const w = (config.buildings as any).dimensions.machineryShed.width;
                    const d = (config.buildings as any).dimensions.machineryShed.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.MACHINERY_SHED, ar);
                }
                break;
            case BuildingType.COOPERATIVE:
                {
                    const w = (config.buildings as any).dimensions.cooperative.width;
                    const d = (config.buildings as any).dimensions.cooperative.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.15);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.COOPERATIVE, ar);
                }
                break;
            case BuildingType.FIELD:
                {
                    const w = (config.buildings as any).dimensions.field.width;
                    const d = (config.buildings as any).dimensions.field.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.98, 1.02);
                    const ar = w / d * math.randomRange(0.95, 1.05);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.FIELD, ar);
                }
                break;
            case BuildingType.POND:
                {
                    const w = (config.buildings as any).dimensions.pond.width;
                    const d = (config.buildings as any).dimensions.pond.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.98, 1.05);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.POND, ar);
                }
                break;
            case BuildingType.STREET_TREE:
                {
                    const dims = (config.buildings as any).dimensions.streetTree;
                    const scale = math.randomRange(0.85, 1.25);
                    const diag = Math.hypot(dims.width, dims.depth) / 2 * Math.sqrt(config.buildings.areaScale) * scale;
                    const ar = (dims.width / dims.depth) * math.randomRange(0.8, 1.25);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.STREET_TREE, ar);
                }
                break;
            case BuildingType.TREE_CLUSTER:
                {
                    const dims = (config.buildings as any).dimensions.treeCluster;
                    const scale = math.randomRange(0.9, 1.3);
                    const diag = Math.hypot(dims.width, dims.depth) / 2 * Math.sqrt(config.buildings.areaScale) * scale;
                    const ar = (dims.width / dims.depth) * math.randomRange(0.85, 1.2);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.TREE_CLUSTER, ar);
                }
                break;
            case BuildingType.LAMP_POST:
                {
                    const dims = (config.buildings as any).dimensions.lampPost;
                    const scale = math.randomRange(0.8, 1.1);
                    const diag = Math.hypot(dims.width, dims.depth) / 2 * Math.sqrt(config.buildings.areaScale) * scale;
                    const ar = (dims.width / Math.max(0.1, dims.depth)) * math.randomRange(0.95, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, Math.max(diag, 0.4), BuildingType.LAMP_POST, ar);
                }
                break;
            case BuildingType.TRASH_BIN:
                {
                    const dims = (config.buildings as any).dimensions.trashBin;
                    const scale = math.randomRange(0.85, 1.2);
                    const diag = Math.hypot(dims.width, dims.depth) / 2 * Math.sqrt(config.buildings.areaScale) * scale;
                    const ar = (dims.width / Math.max(0.1, dims.depth)) * math.randomRange(0.9, 1.2);
                    building = new Building({ x: 0, y: 0 }, 0, Math.max(diag, 0.45), BuildingType.TRASH_BIN, ar);
                }
                break;
            case BuildingType.BENCH:
                {
                    const dims = (config.buildings as any).dimensions.bench;
                    const scale = math.randomRange(0.9, 1.1);
                    const diag = Math.hypot(dims.width, dims.depth) / 2 * Math.sqrt(config.buildings.areaScale) * scale;
                    const ar = (dims.width / Math.max(0.1, dims.depth)) * math.randomRange(0.95, 1.15);
                    building = new Building({ x: 0, y: 0 }, 0, Math.max(diag, 0.6), BuildingType.BENCH, ar);
                }
                break;
        }
        return building;
    },

    aroundSegment(buildingTemplate: () => Building, segment: Segment, count: number, radius: number, quadtree: Quadtree, zoneAt: (p: math.Point) => ZoneName = getZoneAt, time: number = Date.now()): Building[] {
        // Posiciona construções alinhadas à via e com recuo — garante um lado próximo à estrada
        const buildings: Building[] = [];
    const segZone = zoneAt(segment.r.end);
        const s = segment.r.start, e = segment.r.end;
        const vx = e.x - s.x, vy = e.y - s.y;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len, uy = vy / len; // direção da via
        const nx = -uy, ny = ux;            // normal à esquerda
        const w = segment.width;
        // recuo frontal por zona (fallbacks simples)
        const setbackByZone: Record<string, number> = { downtown: 2, commercial: 2, industrial: 4, rural: 6, residential: 6 } as any;
        const baseSetback = (setbackByZone as any)[segZone] ?? 2;
    const margin = Math.max(14, w * 0.6 + 4); // evitar esquinas com folga extra

    // controle de espaçamento ao longo da via por lado
    const placedTBySide: Record<1 | -1, number[]> = { 1: [], [-1]: [] } as any;
    for (let i = 0; i < count; i++) {
            // amostrar posição ao longo da via e lado
            const t = math.randomRange(margin, Math.max(margin, len - margin));
            const side = Math.random() < 0.5 ? -1 : +1;
            const base: math.Point = { x: s.x + ux * t, y: s.y + uy * t };

            // construir tipo por zona e alinhar
            const b = buildingFactory.fromZone(segZone, time);
            b.setDir(segment.dir());
            // distância transversal até encostar próximo da via = meia profundidade + recuo + meia via
            const halfAcross = b.diagonal * math.sinDegrees(b.aspectDegree);
            const off = (w / 2) + baseSetback + Math.max(2, halfAcross);
            const jSide = math.randomRange(-0.8, 0.8);
            const jAlong = math.randomRange(-2.0, 2.0);
            const cx = base.x + ux * jAlong + nx * (off + jSide) * side;
            const cy = base.y + uy * jAlong + ny * (off + jSide) * side;
            b.setCenter({ x: cx, y: cy });

            // colisão/ajuste local
            let permitBuilding = false;
            for (let j = 0; j < Math.max(3, config.mapGeneration.BUILDING_PLACEMENT_LOOP_LIMIT + 1); j++) {
                let collisionCount = 0;
                const queryBounds = b.collider.limits();
                const potentialCollisions: any[] = quadtree.retrieve(queryBounds);
                const localCollisions = buildings.filter(ob => {
                    const lim = ob.collider.limits();
                    return !(lim.x + lim.width < queryBounds.x || queryBounds.x + queryBounds.width < lim.x || lim.y + lim.height < queryBounds.y || queryBounds.y + queryBounds.height < lim.y);
                });
                for (const obj of [...potentialCollisions, ...localCollisions]) {
                    const otherBuilding = obj.o || obj;
                    if (otherBuilding === b) continue;
                    const result = b.collider.collide(otherBuilding.collider);
                    if (result) {
                        collisionCount++;
                        if (typeof result !== 'boolean') {
                            b.setCenter(math.addPoints(b.center, result));
                        }
                    }
                }
                if (collisionCount === 0) { permitBuilding = true; break; }
            }

            if (permitBuilding) {
                // Snap final: projeta ao longo da via e recoloca a uma distância fixa da borda da rua
                const dx = b.center.x - s.x;
                const dy = b.center.y - s.y;
                const tRaw = dx * ux + dy * uy;
                // prédios grandes ganham buffer extra de esquina
                const bigSet = new Set([
                    (BuildingType as any).COMMERCIAL_LARGE,
                    (BuildingType as any).SHOPPING_CENTER,
                    (BuildingType as any).SUPERMARKET,
                    (BuildingType as any).FACTORY,
                    (BuildingType as any).FACTORY_MEDIUM,
                    (BuildingType as any).DISTRIBUTION_CENTER,
                    (BuildingType as any).INDUSTRIAL_COMPLEX,
                    (BuildingType as any).POWER_PLANT,
                    (BuildingType as any).PARKING,
                ]);
                const isBig = bigSet.has((b.type as any));
                const marginLocal = margin + (isBig ? 6 : 0);
                const t = Math.max(marginLocal, Math.min(len - marginLocal, tRaw));
                const px = s.x + ux * t;
                const py = s.y + uy * t;
                const halfAcrossNew = b.diagonal * math.sinDegrees(b.aspectDegree);
                const offDesired = (w / 2) + baseSetback + Math.max(2, halfAcrossNew);
                const cand1 = { x: px + nx * offDesired, y: py + ny * offDesired };
                const cand2 = { x: px - nx * offDesired, y: py - ny * offDesired };
                const d1 = (cand1.x - b.center.x) ** 2 + (cand1.y - b.center.y) ** 2;
                const d2 = (cand2.x - b.center.x) ** 2 + (cand2.y - b.center.y) ** 2;
                const best = d1 <= d2 ? cand1 : cand2;
                b.setCenter(best);

                // Verificação de colisão pós-snap; se colidir, tentar deslizar ao longo da via
                const slideSteps = [0, 1, -1, 2, -2, 3, -3];
                const stepM = Math.max(6, (2 * b.diagonal * math.cosDegrees(b.aspectDegree)) * 0.6);
                let ok = false;
                let chosenK = 0;
                for (const k of slideSteps) {
                    if (k !== 0) {
                        const px2 = px + ux * stepM * k;
                        const py2 = py + uy * stepM * k;
                        const cand1s = { x: px2 + nx * offDesired, y: py2 + ny * offDesired };
                        const cand2s = { x: px2 - nx * offDesired, y: py2 - ny * offDesired };
                        const d1s = (cand1s.x - b.center.x) ** 2 + (cand1s.y - b.center.y) ** 2;
                        const d2s = (cand2s.x - b.center.x) ** 2 + (cand2s.y - b.center.y) ** 2;
                        const bestS = d1s <= d2s ? cand1s : cand2s;
                        b.setCenter(bestS);
                    }
                    const bounds = b.collider.limits();
                    const candidates: any[] = quadtree.retrieve(bounds);
                    const locals = buildings.filter(ob => {
                        const lim = ob.collider.limits();
                        return !(lim.x + lim.width < bounds.x || bounds.x + bounds.width < lim.x || lim.y + lim.height < bounds.y || bounds.y + bounds.height < lim.y);
                    });
                    let collisions = 0;
                    for (const obj of [...candidates, ...locals]) {
                        const other = obj.o || obj;
                        if (other === b) continue;
                        if (b.collider.collide(other.collider)) { collisions++; break; }
                    }
                    if (collisions === 0) { ok = true; chosenK = k; break; }
                }
                if (ok) {
                    // Checagem de espaçamento mínimo ao longo da via por lado
                    const frontWidth = 2 * b.diagonal * math.cosDegrees(b.aspectDegree);
                    const minAlong = Math.max(10, frontWidth * 1.0 + 2 * 1.0); // margem simples
                    const sgn = (best === cand1 ? +1 : -1) as 1 | -1;
                    const tFinal = t + stepM * chosenK;
                    const list = placedTBySide[sgn];
                    let bad = false;
                    for (const tv of list) { if (Math.abs(tFinal - tv) < minAlong) { bad = true; break; } }
                    if (!bad) { list.push(tFinal); }
                    if (!bad) {
                    // Regra: manter fábricas afastadas entre si na zona industrial
                    const heavySet = new Set([
                        (BuildingType as any).FACTORY,
                        (BuildingType as any).FACTORY_MEDIUM,
                        (BuildingType as any).DISTRIBUTION_CENTER,
                        (BuildingType as any).INDUSTRIAL_COMPLEX,
                        (BuildingType as any).POWER_PLANT,
                    ]);
                    const isFactory = heavySet.has((b.type as any));
                    const isIndustrial = segZone === 'industrial';
                    if (isFactory && isIndustrial) {
                        const spacing = ((config as any).zones.industrial.minFactorySpacingM ?? 200);
                        const spacing2 = spacing * spacing;
                        let tooClose = false;
                        for (const ob of buildings) {
                            const otherIsFactory = ob.type === (BuildingType as any).FACTORY || (ob.type as any) === 'factory';
                            if (!otherIsFactory) continue;
                            const dx = ob.center.x - b.center.x;
                            const dy = ob.center.y - b.center.y;
                            if (dx*dx + dy*dy < spacing2) { tooClose = true; break; }
                        }
                        if (tooClose) {
                            // tentar deslizar mais ao longo da via para atender a distância
                            let spaced = false;
                            const extraSlides = [3, -3, 4, -4];
                            for (const k of extraSlides) {
                                const px3 = s.x + ux * (t + stepM * k);
                                const py3 = s.y + uy * (t + stepM * k);
                                const cand = { x: px3 + nx * offDesired * (d1 <= d2 ? 1 : -1), y: py3 + ny * offDesired * (d1 <= d2 ? 1 : -1) };
                                b.setCenter(cand);
                                let okDist = true;
                                for (const ob of buildings) {
                                    const otherIsFactory = heavySet.has((ob.type as any));
                                    if (!otherIsFactory) continue;
                                    const dx = ob.center.x - b.center.x;
                                    const dy = ob.center.y - b.center.y;
                                    if (dx*dx + dy*dy < spacing2) { okDist = false; break; }
                                }
                                if (okDist) { spaced = true; break; }
                            }
                            if (!spaced) {
                                // desistir desta fábrica
                            } else {
                                buildings.push(b);
                            }
                        } else {
                            buildings.push(b);
                        }
                    } else {
                        buildings.push(b);
                    }
                    }
                }
            }
        }
        return buildings;
    },

    // Casas organizadas ao longo do segmento (ambos os lados), com recuo fixo e espaçamento uniforme
    lotsAlongSegment(
        buildingPicker: () => Building,
        segment: Segment,
        quadtree: Quadtree,
        options?: {
            marginM?: number;        // margem nos extremos da rua
            spacingM?: number;       // distância entre centros ao longo da rua
            setbackM?: number;       // recuo da borda da via
            sideSetbackM?: number;   // recuo lateral entre casas (gap mínimo)
            sideJitterM?: number;    // jitter transversal
            alongJitterM?: number;   // jitter longitudinal
            placeBothSides?: boolean;
            startOffsetM?: number;   // deslocamento inicial ao longo da via (para centralizar a malha)
            staggerOppositeSide?: boolean; // desfasar casas do lado oposto em meio passo
        },
        zoneAt: (p: math.Point) => ZoneName = getZoneAt,
        time: number = Date.now()
    ): Building[] {
        const opts = options || {};
        const margin = opts.marginM ?? 10;
        const baseSpacing = Math.max(10, opts.spacingM ?? 20);
        const setback = Math.max(2, opts.setbackM ?? 6);
        const sideSetback = Math.max(0, opts.sideSetbackM ?? 0);
        const jSide = opts.sideJitterM ?? 1.2;
        let jAlong = opts.alongJitterM ?? 0.8;
    const both = opts.placeBothSides !== false;

        const s = segment.r.start, e = segment.r.end;
        const vx = e.x - s.x, vy = e.y - s.y;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len, uy = vy / len; // direção da via
        const nx = -uy, ny = ux; // normal à esquerda
        const w = segment.width;
        const segZone = zoneAt(segment.r.end);

    const buildings: Building[] = [];
    // controle de espaçamento por lado ao longo da via (para evitar encavalamento por footprints maiores que o spacing base)
    const placedTBySide: Record<1 | -1, number[]> = { 1: [], [-1]: [] } as any;

    // Estimar largura frontal típica do prédio para impor espaçamento mínimo
    let template = buildingPicker();
        // largura projetada ao longo da via (2 * diag * cos(aspect))
        const frontWidth = 2 * template.diagonal * math.cosDegrees(template.aspectDegree);
        const spacingMin = Math.max(10, frontWidth + 2 * sideSetback);
        const spacing = Math.max(baseSpacing, spacingMin);
        // jitter ao longo não deve quebrar o recuo lateral
        jAlong = Math.min(jAlong, Math.max(0, sideSetback * 0.4));

        // varrer ao longo do segmento, pulando margens nas extremidades para evitar cruzamentos
    const startT = margin + Math.max(0, opts.startOffsetM ?? 0);
    for (let t = startT; t <= len - margin; t += spacing) {
            const sides = both ? [-1, +1] as const : [+1] as const;
            for (const side of sides) {
                const tp = t + ((opts.staggerOppositeSide && side < 0) ? spacing * 0.5 : 0);
                const base: math.Point = { x: s.x + ux * tp + (Math.random() * 2 - 1) * jAlong, y: s.y + uy * tp + (Math.random() * 2 - 1) * jAlong };
                // escolher tipo via callback (ex.: sempre casa na residencial)
                let b = buildingPicker();
                // forçar orientação alinhada à via
                b.setDir(segment.dir());
                // deslocamento transversal: metade da via + recuo + meia-profundidade aproximada
                const halfAcross = b.diagonal * math.sinDegrees(b.aspectDegree);
                // recuo transversal: via/2 + setback + margem adicional
                const extra = Math.max(0, segZone === 'residential' ? 2 : 0);
                const off = (w / 2) + setback + Math.max(3, halfAcross + extra);
                const cx = base.x + nx * off * side + (Math.random() * 2 - 1) * jSide;
                const cy = base.y + ny * off * side + (Math.random() * 2 - 1) * jSide;
                b.setCenter({ x: cx, y: cy });

                // Nota: filtro de footprint removido a pedido do usuário

                // tentativa rápida de resolver colisões locais como no aroundSegment
                let permit = false;
                for (let j = 0; j < Math.max(3, config.mapGeneration.BUILDING_PLACEMENT_LOOP_LIMIT + 1); j++) {
                    let collisions = 0;
                    const bounds = b.collider.limits();
                    const candidates: any[] = quadtree.retrieve(bounds);
                    const locals = buildings.filter(ob => {
                        const lim = ob.collider.limits();
                        return !(lim.x + lim.width < bounds.x || bounds.x + bounds.width < lim.x || lim.y + lim.height < bounds.y || bounds.y + bounds.height < lim.y);
                    });
                    for (const obj of [...candidates, ...locals]) {
                        const other = obj.o || obj;
                        if (other === b) continue;
                        const res = b.collider.collide(other.collider);
                        if (res) {
                            collisions++;
                            if (typeof res !== 'boolean') {
                                b.setCenter(math.addPoints(b.center, res));
                            }
                        }
                    }
                    if (collisions === 0) { permit = true; break; }
                }

                if (permit) {
                    // Snap final para reforçar aderência à via e margem uniforme
                    const dx = b.center.x - s.x;
                    const dy = b.center.y - s.y;
                    const tRaw = dx * ux + dy * uy;
                    // prédios grandes ganham buffer extra de esquina
                    const bigSet2 = new Set([
                        (BuildingType as any).COMMERCIAL_LARGE,
                        (BuildingType as any).SUPERMARKET,
                        (BuildingType as any).SHOPPING_CENTER,
                        (BuildingType as any).FACTORY,
                        (BuildingType as any).FACTORY_MEDIUM,
                        (BuildingType as any).DISTRIBUTION_CENTER,
                        (BuildingType as any).INDUSTRIAL_COMPLEX,
                        (BuildingType as any).POWER_PLANT,
                        (BuildingType as any).PARKING,
                    ]);
                    const isBig2 = bigSet2.has((b.type as any));
                    const marginLocal2 = margin + (isBig2 ? 6 : 0);
                    const tClamped = Math.max(marginLocal2, Math.min(len - marginLocal2, tRaw));
                    const px = s.x + ux * tClamped;
                    const py = s.y + uy * tClamped;
                    const halfAcrossNew = b.diagonal * math.sinDegrees(b.aspectDegree);
                    const offDesired = (w / 2) + setback + Math.max(3, halfAcrossNew + extra);
                    const cand1 = { x: px + nx * offDesired, y: py + ny * offDesired };
                    const cand2 = { x: px - nx * offDesired, y: py - ny * offDesired };
                    // manter o lado escolhido inicialmente
                    const prefer = side > 0 ? cand1 : cand2;
                    b.setCenter(prefer);

                    // Verificação de colisão pós-snap com deslizamento ao longo da via
                    const slideSteps = [0, 1, -1, 2, -2, 3, -3];
                    const stepM = Math.max(6, (2 * b.diagonal * math.cosDegrees(b.aspectDegree)) * 0.6);
                    let ok = false;
                    let chosenK = 0;
                    for (const k of slideSteps) {
                        if (k !== 0) {
                            const px2 = px + ux * stepM * k;
                            const py2 = py + uy * stepM * k;
                            const candS = side > 0 ? { x: px2 + nx * offDesired, y: py2 + ny * offDesired } : { x: px2 - nx * offDesired, y: py2 - ny * offDesired };
                            b.setCenter(candS);
                        }
                        const bounds2 = b.collider.limits();
                        const candidates2: any[] = quadtree.retrieve(bounds2);
                        const locals2 = buildings.filter(ob => {
                            const lim = ob.collider.limits();
                            return !(lim.x + lim.width < bounds2.x || bounds2.x + bounds2.width < lim.x || lim.y + lim.height < bounds2.y || bounds2.y + bounds2.height < lim.y);
                        });
                        let collisions2 = 0;
                        for (const obj of [...candidates2, ...locals2]) {
                            const other = obj.o || obj;
                            if (other === b) continue;
                            if (b.collider.collide(other.collider)) { collisions2++; break; }
                        }
                        if (collisions2 === 0) { ok = true; chosenK = k; break; }
                    }
                    if (ok) {
                        // Checagem de espaçamento mínimo ao longo da via por lado
                        const frontWidth = 2 * b.diagonal * math.cosDegrees(b.aspectDegree);
                        const minAlong = Math.max(spacing, frontWidth * 1.0 + 2 * sideSetback);
                        const sgn = (side > 0 ? +1 : -1) as 1 | -1;
                        const tFinal = t + ((opts.staggerOppositeSide && side < 0) ? spacing * 0.5 : 0) + stepM * chosenK;
                        const list = placedTBySide[sgn];
                        let bad = false;
                        for (const tv of list) { if (Math.abs(tFinal - tv) < minAlong) { bad = true; break; } }
                        if (!bad) { list.push(tFinal); }
                        if (!bad) {
                        // Se for fábrica em zona industrial, manter raio mínimo
                        const heavySet2 = new Set([
                            (BuildingType as any).FACTORY,
                            (BuildingType as any).FACTORY_MEDIUM,
                            (BuildingType as any).DISTRIBUTION_CENTER,
                            (BuildingType as any).INDUSTRIAL_COMPLEX,
                            (BuildingType as any).POWER_PLANT,
                        ]);
                        const isFactory = heavySet2.has((b.type as any));
                        const isIndustrial = segZone === 'industrial';
                        if (isFactory && isIndustrial) {
                            const spacing = ((config as any).zones.industrial.minFactorySpacingM ?? 200);
                            const spacing2 = spacing * spacing;
                            let tooClose = false;
                            for (const ob of buildings) {
                                const otherIsFactory = heavySet2.has((ob.type as any));
                                if (!otherIsFactory) continue;
                                const dx = ob.center.x - b.center.x;
                                const dy = ob.center.y - b.center.y;
                                if (dx*dx + dy*dy < spacing2) { tooClose = true; break; }
                            }
                            if (!tooClose) {
                                buildings.push(b);
                            }
                        } else {
                            buildings.push(b);
                        }
                        }
                    }
                }
            }
        }
        return buildings;
    },

    streetFurnitureAlongSegment(
        segment: Segment,
        quadtree: Quadtree,
        existingBuildings: Building[],
        zoneAt: (p: math.Point) => ZoneName = getZoneAt,
        time: number = Date.now()
    ): Building[] {
        const zone = zoneAt(segment.r.end);
        const zoneCfg = ((config as any).zones?.[zone] || {}) as any;
        const decorCfg = zoneCfg?.decor;
        if (!decorCfg) return [];
        const mixEntries = Object.entries(decorCfg.mix || {}).filter(([, weight]) => Number(weight) > 0)
            .map(([key, weight]) => ({ key, weight: Number(weight) }));
        if (!mixEntries.length) return [];
        const totalWeight = mixEntries.reduce((acc, entry) => acc + entry.weight, 0);
        if (!(totalWeight > 0)) return [];

        const pickType = (): BuildingType | null => {
            let r = Math.random() * totalWeight;
            for (const entry of mixEntries) {
                r -= entry.weight;
                if (r <= 0) return entry.key as BuildingType;
            }
            return mixEntries[mixEntries.length - 1].key as BuildingType;
        };

        const spacing = Math.max(6, Number(decorCfg.spacingM ?? 18));
        const offsetBase = Number.isFinite(decorCfg.offsetM) ? Number(decorCfg.offsetM) : 2.0;
        const density = Math.max(0, Math.min(1, Number(decorCfg.density ?? 0.75)));
        const alongJitter = Math.max(0, Number(decorCfg.alongJitterM ?? 1.2));
        const sideJitter = Math.max(0, Number(decorCfg.sideJitterM ?? 0.6));
        const offsetJitter = Math.max(0, Number(decorCfg.offsetJitterM ?? 0.4));
        const depthFactor = Number.isFinite(decorCfg.depthFactor) ? Number(decorCfg.depthFactor) : 0.5;
        const marginCfg = Number.isFinite(decorCfg.marginM) ? Number(decorCfg.marginM) : undefined;

        const placeBothSides = decorCfg.placeBothSides !== false;
        const preferredSide = decorCfg.preferredSide === 'left' ? 1 : -1;
        const sides: Array<1 | -1> = placeBothSides ? [-1, 1] : [preferredSide as 1 | -1];

        const s = segment.r.start;
        const e = segment.r.end;
        const vx = e.x - s.x;
        const vy = e.y - s.y;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len;
        const uy = vy / len;
        const nx = -uy;
        const ny = ux;
        const margin = Math.max(4, Math.min(len / 2, marginCfg ?? Math.max(4, spacing * 0.5)));
        if (len <= margin * 2) return [];

        const results: Building[] = [];
        for (let base = margin; base <= len - margin; base += spacing) {
            const tBase = base + math.randomRange(-alongJitter, alongJitter);
            const t = Math.max(margin, Math.min(len - margin, tBase));
            const pointOnSeg: math.Point = { x: s.x + ux * t, y: s.y + uy * t };
            for (const side of sides) {
                if (Math.random() > density) continue;
                const type = pickType();
                if (!type) continue;
                const building = this.byType(type, time + results.length + (side > 0 ? 0 : 1000));
                if (!building) continue;
                building.setDir(segment.dir());
                const halfAcross = building.diagonal * math.sinDegrees(building.aspectDegree);
                const offset = (segment.width / 2) + Math.max(0.4, offsetBase) + Math.max(0, halfAcross * Math.max(0, depthFactor)) + math.randomRange(-offsetJitter, offsetJitter);
                const cx = pointOnSeg.x + nx * offset * side + math.randomRange(-sideJitter, sideJitter);
                const cy = pointOnSeg.y + ny * offset * side + math.randomRange(-sideJitter, sideJitter);
                building.setCenter({ x: cx, y: cy });

                const bounds = building.collider.limits();
                const qCandidates: any[] = quadtree.retrieve(bounds) || [];
                const nearExisting = existingBuildings.filter(ob => {
                    const lim = ob.collider.limits();
                    return !(lim.x + lim.width < bounds.x || bounds.x + bounds.width < lim.x || lim.y + lim.height < bounds.y || bounds.y + bounds.height < lim.y);
                });
                let collision = false;
                for (const obj of qCandidates) {
                    const other = (obj as any).o || obj;
                    if (!other || other === building || !(other as any).collider) continue;
                    if (building.collider.collide((other as any).collider)) { collision = true; break; }
                }
                if (collision) continue;
                for (const other of [...nearExisting, ...results]) {
                    if (other === building) continue;
                    if (building.collider.collide(other.collider)) { collision = true; break; }
                }
                if (!collision) {
                    results.push(building);
                }
            }
        }
        return results;
    }
};