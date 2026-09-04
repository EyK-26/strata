import axios from "axios";
import React, { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ApplicantList from "./ApplicantList";
import PositionDetailDetails from "./PositionDetailDetails";
import Context from "../../context/Context";
import DeletePosition from "../admin/DeletePosition";
import Comments from "../comments/Comments";
import { Link } from "react-router-dom";

const PositionDetail = () => {
    const { state } = useContext(Context);
    const [positionData, setPositionData] = useState([]);
    const { id } = useParams();
    const navigate = useNavigate();

    const fetchPositionDetail = async () => {
        try {
            const response = await axios.get(`/api/positions/${id}`);
            setPositionData(response.data);
        } catch (err) {
            console.log(err.response);
        }
    };

    useEffect(() => {
        fetchPositionDetail();
    }, []);

    return (
        <>
            <button onClick={() => navigate(-1)}>back</button>
            <div>
                <h2>Position Details</h2>
                {state.user.role_id === 1 && <DeletePosition />}
                <PositionDetailDetails position={positionData.position} />
                <p>
                    <Link to={`/positions/${id}/skills`}>Skills and match</Link>
                </p>
                {positionData.position?.department_id && (
                    <p>
                        <Link
                            to={`/departments/${positionData.position.department_id}/applications`}
                        >
                            Department applications
                        </Link>
                    </p>
                )}
            </div>
            <div>
                <h3>Applicants</h3>
                <div>
                    {positionData.applications?.length === 0 ? (
                        "No applicants yet"
                    ) : (
                        <ApplicantList applicants={positionData.applications} />
                    )}
                </div>
            </div>
            <Comments kind="positions" id={id} />
        </>
    );
};

export default PositionDetail;
