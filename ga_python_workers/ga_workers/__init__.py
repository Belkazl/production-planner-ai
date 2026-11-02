"""Isolated process supervision for LiftOrbit's Python genetic optimizer.

The production GA adapter must be configured before live use; the fixture is
strictly for test environments. No tenant identity comes from a job payload.
"""
from .manager import ProcessJobManager, JobConflict, JobNotFound, ForbiddenJob, ServiceBusy

__all__ = ["ProcessJobManager", "JobConflict", "JobNotFound", "ForbiddenJob", "ServiceBusy"]
