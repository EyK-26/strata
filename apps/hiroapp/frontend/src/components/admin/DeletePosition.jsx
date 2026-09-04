import axios from "axios";
import React from "react";
import { useNavigate, useParams } from "react-router-dom";

const DeletePosition = () => {
    const navigate = useNavigate();
    const { id } = useParams();

    const deletePosition = async () => {
        try {
            const response = await axios.post(`/api/positions/${id}/delete`);
            navigate("/positions");
        } catch (error) {
            console.log(error.response.data);
        }
    };
    return (
        <>
            <button onClick={deletePosition}>Close Position</button>
        </>
    );
};

export default DeletePosition;
