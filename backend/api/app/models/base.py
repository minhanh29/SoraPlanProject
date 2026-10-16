from pydantic import BaseModel, ConfigDict


def to_camel(snake_str: str) -> str:
    """Convert snake_case to camelCase for API wire consistency."""
    components = snake_str.split("_")
    return components[0] + "".join(x.capitalize() for x in components[1:])


class BaseSchema(BaseModel):
    """Base schema configured with camelCase serialization and population by field name."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
