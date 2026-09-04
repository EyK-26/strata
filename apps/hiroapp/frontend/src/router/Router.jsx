import React, { useContext } from "react";
import { Route, Routes } from "react-router-dom";
import Layout from "../layout/Layout";
import Login from "../components/auth/Login";
import Logout from "../components/auth/Logout";
import RecruiterHome from "../components/recruiter/Home";
import CandidateHome from "../components/candidate/Home";
import AdminHome from "../components/admin/Home";
import Context from "../context/Context";
import Unauthorized from "../components/Unauthorized";
import ApplicationDetail from "../components/candidate/ApplicationDetail";
import Applications from "../components/candidate/Applications";
import Positions from "../components/candidate/Positions";
import Position from "../components/candidate/Position";
import PositionDetail from "../components/recruiter/PositionDetail";
import CreateApplication from "../components/candidate/CreateApplication";
import CreateUser from "../components/admin/CreateUser";
import CreatePosition from "../components/recruiter/CreatePosition";
import UserDetail from "../components/user/UserDetail";
import OpenPositions from "../components/admin/OpenPositions";
import Users from "../components/admin/Users";
import YourHirings from "../components/recruiter/YourHirings";
import Dashboard from "../components/recruiter/dashboard/Dashboard";
import Skills from "../components/skills/Skills";
import Watchlist from "../components/skills/Watchlist";
import PositionSkills from "../components/skills/PositionSkills";
import FailedJobs from "../components/admin/FailedJobs";
import DepartmentApps from "../components/recruiter/DepartmentApps";

const Router = ({ loadUserStatus }) => {
    const { state } = useContext(Context);
    const roleRoutes = () => {
        switch (state.user?.role_id) {
            case 1:
                return (
                    <>
                        <Route index element={<AdminHome />} />
                        <Route path="/users/" element={<Users />} />
                        <Route path="/users/create" element={<CreateUser />} />
                        <Route path="/users/:id" element={<UserDetail />} />
                        <Route path="/positions" element={<OpenPositions />} />
                        <Route
                            path="/positions/:id"
                            element={<PositionDetail />}
                        />
                        <Route
                            path="/applications/:id"
                            element={<ApplicationDetail />}
                        />
                        <Route path="/failed-jobs" element={<FailedJobs />} />
                        <Route
                            path="/positions/:id/skills"
                            element={<PositionSkills />}
                        />
                        <Route
                            path="/departments/:id/applications"
                            element={<DepartmentApps />}
                        />
                    </>
                );
            case 2:
                return (
                    <>
                        <Route index element={<CandidateHome />} />
                        <Route
                            path="/applications"
                            element={<Applications />}
                        />
                        <Route path="/positions" element={<Positions />} />
                        <Route
                            path="/apply/:id"
                            element={<CreateApplication />}
                        />
                        <Route path="/positions/:id" element={<Position />} />
                        <Route
                            path="/applications/:id"
                            element={<ApplicationDetail />}
                        />
                        <Route path="/skills" element={<Skills />} />
                        <Route path="/watching" element={<Watchlist />} />
                    </>
                );
            case 3:
                return (
                    <>
                        <Route index element={<RecruiterHome />} />
                        <Route
                            path="/positions/:id"
                            element={<PositionDetail />}
                        />
                        <Route
                            path="/applications/:id"
                            element={<ApplicationDetail />}
                        />
                        <Route
                            path="/position/create"
                            element={<CreatePosition />}
                        />
                        <Route path="/hirings" element={<YourHirings />} />
                        <Route path="/users/:id" element={<UserDetail />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/skills" element={<Skills />} />
                        <Route
                            path="/positions/:id/skills"
                            element={<PositionSkills />}
                        />
                        <Route
                            path="/departments/:id/applications"
                            element={<DepartmentApps />}
                        />
                    </>
                );
            default:
                break;
        }
    };

    return (
        <Routes>
            <Route path="/" element={<Layout />}>
                {roleRoutes()}
                <Route path="/logout" element={<Logout />} />
                <Route path="*" element={<Unauthorized />} />
            </Route>
            {!state.user && (
                <Route
                    path="/login"
                    element={<Login loadUserStatus={loadUserStatus} />}
                />
            )}
        </Routes>
    );
};

export default Router;
