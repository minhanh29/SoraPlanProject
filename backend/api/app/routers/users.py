from fastapi import APIRouter, Depends, status

from ..deps import get_current_user, get_sample_service, get_user_service
from ..models.user import UpdateUserRequest, UserProfile, UserQuotaResponse
from ..services.sample_service import SampleService
from ..services.user_service import UserService

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/me",
    response_model=UserProfile,
    status_code=status.HTTP_200_OK,
    summary="Get current user details",
)
def get_current_user_profile(
    current_user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    return current_user


@router.patch(
    "/me",
    response_model=UserProfile,
    status_code=status.HTTP_200_OK,
    summary="Update current user profile",
)
def update_current_user_profile(
    payload: UpdateUserRequest,
    current_user: UserProfile = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
) -> UserProfile:
    return user_service.update_user_profile(current_user.uid, payload)


@router.post(
    "/me/samples",
    status_code=status.HTTP_200_OK,
    summary="Copy the sample projects into a new account (once; later calls are no-ops)",
)
def copy_sample_projects(
    current_user: UserProfile = Depends(get_current_user),
    samples: SampleService = Depends(get_sample_service),
) -> dict:
    return samples.ensure_samples(current_user.uid)


@router.get(
    "/me/quota",
    response_model=UserQuotaResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current user quotas",
)
def get_current_user_quota(
    current_user: UserProfile = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
) -> UserQuotaResponse:
    return user_service.get_quota(current_user.uid)


@router.get(
    "/{uid}",
    response_model=UserProfile,
    status_code=status.HTTP_200_OK,
    summary="Get user profile by UID",
)
def get_user_by_uid(
    uid: str,
    _: UserProfile = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
) -> UserProfile:
    return user_service.get_user_or_raise(uid)
