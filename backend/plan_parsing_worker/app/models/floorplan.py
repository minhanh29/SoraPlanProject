from typing import List, Literal, Optional, Dict, Any
from pydantic import BaseModel, Field


class Point2D(BaseModel):
    x: float
    y: float


class StatedDimensions(BaseModel):
    width: Optional[float] = None
    height: Optional[float] = None


class Wall(BaseModel):
    id: str
    type: Literal["wall"] = "wall"
    x1: float
    y1: float
    x2: float
    y2: float
    thickness: float = Field(default=0.55, description="Wall thickness in plan units")
    exterior: bool = Field(default=False)
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


class Door(BaseModel):
    id: str
    type: Literal["door"] = "door"
    x: float
    y: float
    width: float
    rotation: float = 0.0
    swing: Optional[Literal["left", "right", "double", "sliding", "unknown"]] = "unknown"
    wallId: Optional[str] = None
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


class Window(BaseModel):
    id: str
    type: Literal["window"] = "window"
    x: float
    y: float
    width: float
    rotation: float = 0.0
    wallId: Optional[str] = None
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


FurnitureCategory = Literal[
    "bed",
    "sofa",
    "chair",
    "armchair",
    "table",
    "coffee_table",
    "dining_table",
    "desk",
    "nightstand",
    "wardrobe",
    "cabinet",
    "kitchen_island",
    "unknown",
]


class Furniture(BaseModel):
    id: str
    type: Literal["furniture"] = "furniture"
    furnitureType: FurnitureCategory = "unknown"
    label: str
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0.0
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


FixtureCategory = Literal[
    "sink",
    "toilet",
    "bathtub",
    "shower",
    "stove",
    "oven",
    "refrigerator",
    "washer",
    "dryer",
    "counter",
    "unknown",
]


class Fixture(BaseModel):
    id: str
    type: Literal["fixture"] = "fixture"
    fixtureType: FixtureCategory = "unknown"
    label: str
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0.0
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


class Room(BaseModel):
    id: str
    name: str
    polygon: List[Point2D]
    labelPosition: Optional[Point2D] = None
    statedDimensions: Optional[StatedDimensions] = None
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


class RoomCorners(BaseModel):
    topLeft: Point2D
    topRight: Point2D
    bottomRight: Point2D
    bottomLeft: Point2D
    cropX: float
    cropY: float
    cropWidth: float
    cropHeight: float
    planWidth: float
    planHeight: float
    units: Literal["ft", "m"] = "ft"
    confidence: float = Field(default=0.95, ge=0.0, le=1.0)


class SourceImage(BaseModel):
    width: int
    height: int
    cropX: Optional[float] = None
    cropY: Optional[float] = None
    cropWidth: Optional[float] = None
    cropHeight: Optional[float] = None
    corners: Optional[Dict[str, Point2D]] = None


class FloorPlan(BaseModel):
    id: str
    units: Literal["ft", "m", "normalized"] = "ft"
    width: float
    height: float
    sourceImage: Optional[SourceImage] = None
    scaleConfidence: float = Field(default=0.9, ge=0.0, le=1.0)
    rooms: List[Room] = Field(default_factory=list)
    walls: List[Wall] = Field(default_factory=list)
    doors: List[Door] = Field(default_factory=list)
    windows: List[Window] = Field(default_factory=list)
    furniture: List[Furniture] = Field(default_factory=list)
    fixtures: List[Fixture] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None
