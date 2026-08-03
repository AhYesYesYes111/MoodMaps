from fastapi import APIRouter, Depends, Request

from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.services.route_analysis import RouteAnalysisService

router = APIRouter(tags=["routes"])


def get_service(request: Request) -> RouteAnalysisService:
    return request.app.state.analysis_service


@router.post("/routes/analyze", response_model=AnalyzeResponse)
async def analyze_routes(
    payload: AnalyzeRequest,
    analysis_service: RouteAnalysisService = Depends(get_service),
) -> AnalyzeResponse:
    return await analysis_service.analyze(payload)
